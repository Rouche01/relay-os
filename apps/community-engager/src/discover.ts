import type { ContextEngine } from "@relay/context-engine";
import type { DecisionPort } from "@relay/engines-decide";
import { createDecisionPort } from "@relay/engines-decide";
import type { PlaywrightEngine } from "@relay/engines-browser";
import {
  getAllowlistStore,
  type AllowlistStore,
} from "./allowlist-store.js";
import { resolveDiscoverGate } from "./discover-gate.js";
import {
  getRedditEnv,
  type RedditEnvConfig,
} from "./reddit/config.js";
import {
  discoverSubredditCandidates,
  type DiscoverChallengeHandOff,
  type DiscoveryCandidate,
} from "./reddit/discover-subs.js";

export interface DiscoverResult {
  enabled: boolean;
  /** True when search + decide actually ran. */
  ran: boolean;
  candidates: DiscoveryCandidate[];
  skippedReason?: string;
  /** Headed browser still open — controller must park it for HITL. */
  challenge?: DiscoverChallengeHandOff;
}

/**
 * Read-only discovery lane. Writes proposed entries to the allowlist store
 * (status=proposed only). Never marks postable without HITL.
 * VoltMem preference/rules facts are written on promote (controller), not here.
 */
export async function runDiscovery(opts?: {
  cfg?: RedditEnvConfig;
  store?: AllowlistStore;
  memory?: ContextEngine;
  /** Fit scorer — defaults to createDecisionPort() from env. */
  decide?: DecisionPort;
  /** Intent / CLI force — research even when allowlist is healthy. */
  forceDiscover?: boolean;
  /** Reuse a headed browser that just cleared CAPTCHA (same Chromium). */
  adopt?: { engine: PlaywrightEngine; storagePath: string };
}): Promise<DiscoverResult> {
  const cfg = opts?.cfg ?? getRedditEnv();
  const store = opts?.store ?? getAllowlistStore();
  const postable = await store.listPostable();

  // Mid-CAPTCHA continue must not re-apply the healthy-allowlist skip.
  const forceDiscover = Boolean(opts?.forceDiscover || opts?.adopt);

  const gate = resolveDiscoverGate({
    mode: cfg.discoverMode,
    postableCount: postable.length,
    minPostable: cfg.discoverMinPostable,
    forceDiscover,
  });

  if (!gate.run) {
    const healthy = gate.reason.startsWith("auto:healthy");
    if (healthy) {
      console.log(
        `[discover] skipped — allowlist healthy (${postable.length} postable ≥ min ${cfg.discoverMinPostable})`
      );
    } else {
      console.log(`[discover] skipped — ${gate.reason}`);
    }
    return {
      enabled: cfg.discoverMode !== "off",
      ran: false,
      candidates: [],
      skippedReason: gate.reason,
    };
  }

  console.log(`[discover] gate=${gate.reason}`);

  const exclude = postable.map((e) => e.name);
  const decide = opts?.decide ?? createDecisionPort();

  let candidates: DiscoveryCandidate[] = [];
  let challenge: DiscoverChallengeHandOff | undefined;
  try {
    const raw = await discoverSubredditCandidates({
      cfg,
      exclude,
      query: cfg.discoverQuery,
      limit: cfg.discoverMaxCandidates,
      escalateCaptcha: cfg.interstitialHitl,
      adopt: opts?.adopt,
      decide,
      goal: cfg.discoverGoal,
    });
    candidates = raw.candidates;
    challenge = raw.challenge;
  } catch (err) {
    console.warn("[discover] failed:", err);
    return {
      enabled: true,
      ran: true,
      candidates: [],
      skippedReason: err instanceof Error ? err.message : String(err),
    };
  }

  // Don't persist proposals mid-CAPTCHA; retry after human clears the wall.
  if (challenge) {
    return {
      enabled: true,
      ran: true,
      candidates: [],
      challenge,
      skippedReason: `blocked:${challenge.reason}`,
    };
  }

  // Persist proposals to the allowlist file only. VoltMem facts wait until
  // human promote (episodic event) — bulk remember of near-identical
  // "discovery proposed" lines false-merged across subs.
  for (const c of candidates) {
    await store.upsertProposed({
      name: c.name,
      rulesOk: c.rulesOk,
      note: c.note,
      evidence: c.evidence,
    });
  }

  console.log(
    `[discover] ${candidates.length} candidate(s)` +
      (candidates.length
        ? `: ${candidates.map((c) => `r/${c.name}(${c.fitScore})`).join(", ")}`
        : "")
  );

  return { enabled: true, ran: true, candidates };
}

export const DISCOVER_SKIP_OPTION = "none (skip)";

export function discoveryChoiceOptions(
  candidates: DiscoveryCandidate[]
): string[] {
  return [...candidates.map((c) => `r/${c.name}`), DISCOVER_SKIP_OPTION];
}

export type DiscoveryChoiceResult =
  | { action: "promote"; names: string[] }
  | { action: "skip" };

/** Whole-message skip only (Telegram Approve / shorthand replies). */
const WHOLE_SKIP = new Set([
  "none",
  "skip",
  "none (skip)",
  "abort",
  "n",
  "true",
  "false",
  "approve",
  "a",
  "yes",
  "y",
]);

/** Per-token skip when splitting multi-promote lists (not single-letter aliases). */
const PART_SKIP = new Set(["none", "skip", "none (skip)", "abort"]);

/**
 * Parse discover HITL reply — one or many sub names.
 * Examples: `r/fashion`, `r/a, r/b`, newline-separated lists.
 * Unknown / empty → skip. When `allowed` is set, drop names not in that set.
 */
export function parseDiscoveryChoices(
  value: unknown,
  allowed?: Iterable<string>
): DiscoveryChoiceResult {
  if (value == null || typeof value === "boolean") {
    return { action: "skip" };
  }
  const raw = String(value).trim();
  if (!raw) return { action: "skip" };
  const lowerAll = raw.toLowerCase();
  if (WHOLE_SKIP.has(lowerAll)) return { action: "skip" };

  const allowedSet = allowed
    ? new Set(
        [...allowed].map((n) => n.replace(/^r\//i, "").trim().toLowerCase())
      )
    : undefined;

  const parts = raw
    .split(/[\n,]+/)
    .map((p) =>
      p
        .replace(/^(approve|promote)\s*:?\s*/i, "")
        .replace(/^r\//i, "")
        .trim()
    )
    .filter(Boolean);

  const names: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const key = part.toLowerCase();
    if (PART_SKIP.has(key)) continue;
    if (allowedSet && !allowedSet.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(part.replace(/^r\//i, "").trim());
  }

  if (names.length === 0) return { action: "skip" };
  return { action: "promote", names };
}

/** @deprecated Prefer parseDiscoveryChoices — kept for single-name callers/tests. */
export function parseDiscoveryChoice(
  value: unknown
): { action: "promote"; name: string } | { action: "skip" } {
  const parsed = parseDiscoveryChoices(value);
  if (parsed.action === "skip") return parsed;
  const name = parsed.names[0];
  if (!name) return { action: "skip" };
  return { action: "promote", name };
}
