import type { ContextEngine } from "@relay/context-engine";
import type { PlaywrightEngine } from "@relay/engines-browser";
import {
  getAllowlistStore,
  type AllowlistStore,
} from "./allowlist-store.js";
import { CommunityMemory, communityFactDomain } from "./memory.js";
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
  candidates: DiscoveryCandidate[];
  skippedReason?: string;
  /** Headed browser still open — controller must park it for HITL. */
  challenge?: DiscoverChallengeHandOff;
}

/**
 * Read-only discovery lane. Writes proposed entries to the allowlist store
 * (status=proposed only). Never marks postable without HITL.
 */
export async function runDiscovery(opts?: {
  cfg?: RedditEnvConfig;
  store?: AllowlistStore;
  memory?: ContextEngine;
  /** Reuse a headed browser that just cleared CAPTCHA (same Chromium). */
  adopt?: { engine: PlaywrightEngine; storagePath: string };
}): Promise<DiscoverResult> {
  const cfg = opts?.cfg ?? getRedditEnv();
  if (!cfg.discoverEnabled) {
    return {
      enabled: false,
      candidates: [],
      skippedReason: "COMMUNITY_DISCOVER disabled",
    };
  }

  const store = opts?.store ?? getAllowlistStore();
  const postable = await store.listPostable();
  const exclude = postable.map((e) => e.name);

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
    });
    candidates = raw.candidates;
    challenge = raw.challenge;
  } catch (err) {
    console.warn("[discover] failed:", err);
    return {
      enabled: true,
      candidates: [],
      skippedReason: err instanceof Error ? err.message : String(err),
    };
  }

  // Don't persist proposals mid-CAPTCHA; retry after human clears the wall.
  if (challenge) {
    return {
      enabled: true,
      candidates: [],
      challenge,
      skippedReason: `blocked:${challenge.reason}`,
    };
  }

  for (const c of candidates) {
    await store.upsertProposed({
      name: c.name,
      rulesOk: c.rulesOk,
      note: c.note,
      evidence: c.evidence,
    });
    if (opts?.memory) {
      await opts.memory.addFact(
        CommunityMemory.discoveryProposed(c.name, c.note, c.evidence),
        { domain: communityFactDomain("preference"), source: "relay:community-engager" }
      );
    }
  }

  console.log(
    `[discover] ${candidates.length} candidate(s)` +
      (candidates.length
        ? `: ${candidates.map((c) => `r/${c.name}(${c.fitScore})`).join(", ")}`
        : "")
  );

  return { enabled: true, candidates };
}

export const DISCOVER_SKIP_OPTION = "none (skip)";

export function discoveryChoiceOptions(
  candidates: DiscoveryCandidate[]
): string[] {
  return [...candidates.map((c) => `r/${c.name}`), DISCOVER_SKIP_OPTION];
}

export function parseDiscoveryChoice(
  value: unknown
): { action: "promote"; name: string } | { action: "skip" } {
  if (value == null) return { action: "skip" };
  if (typeof value === "boolean") {
    return { action: "skip" };
  }
  const raw = String(value).trim();
  if (!raw) return { action: "skip" };
  const lower = raw.toLowerCase();
  if (
    lower === "none" ||
    lower === "skip" ||
    lower === "none (skip)" ||
    lower === "abort" ||
    lower === "n" ||
    lower === "true" ||
    lower === "false" ||
    lower === "approve" ||
    lower === "a" ||
    lower === "yes" ||
    lower === "y"
  ) {
    return { action: "skip" };
  }
  const cleaned = raw
    .replace(/^(approve|promote)\s*:?\s*/i, "")
    .replace(/^r\//i, "")
    .trim();
  if (!cleaned) return { action: "skip" };
  return { action: "promote", name: cleaned };
}
