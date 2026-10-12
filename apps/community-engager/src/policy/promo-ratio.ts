import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getCommunityConfig,
  type CommunityRuntimeConfig,
  type PromoOnExceed,
} from "./reddit/config.js";
import type { PromoIntensity } from "./types.js";

export interface PromoLedgerEntry {
  postedAt: string;
  intensity: PromoIntensity;
  jobId?: string;
  /** Subreddit name (for per-sub playbook plugs/week). */
  subreddit?: string;
}

export interface PromoLedgerState {
  entries: PromoLedgerEntry[];
  updatedAt: string;
}

export interface PromoRatioStatus {
  enabled: boolean;
  /** True when a promo (intensity ≥ 1) would push the window over maxRatio. */
  exceeds: boolean;
  /** When exceeds && onExceed === "block", drafts must stay intensity 0. */
  blockPromo: boolean;
  /** When exceeds && onExceed === "warn", HITL should surface a warning. */
  warnPromo: boolean;
  onExceed: PromoOnExceed;
  maxRatio: number;
  windowDays: number;
  helpCount: number;
  promoCount: number;
  /** Current promo/(help+promo) in the window (0 if empty). */
  currentRatio: number;
  /** Ratio if we posted the proposed intensity next. */
  projectedRatio: number;
  reasons: string[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function promoLedgerPath(dataDir: string): string {
  return path.join(dataDir, "promo", "ledger.json");
}

export async function readPromoLedger(dataDir: string): Promise<PromoLedgerState> {
  const file = promoLedgerPath(dataDir);
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<PromoLedgerState>;
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries
          .map(normalizeEntry)
          .filter((e): e is PromoLedgerEntry => e != null)
      : [];
    return {
      entries,
      updatedAt:
        typeof parsed.updatedAt === "string"
          ? parsed.updatedAt
          : new Date(0).toISOString(),
    };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { entries: [], updatedAt: new Date(0).toISOString() };
    }
    throw err;
  }
}

export async function writePromoLedger(
  dataDir: string,
  state: PromoLedgerState
): Promise<void> {
  const file = promoLedgerPath(dataDir);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8"
  );
}

/**
 * Append a live post to the ledger and prune outside the window.
 * Returns the entry count remaining in the window.
 */
export async function recordPromoLedgerPost(
  dataDir: string,
  input: {
    intensity: PromoIntensity;
    jobId?: string;
    subreddit?: string;
    windowDays: number;
    postedAt?: string;
    nowMs?: number;
  }
): Promise<number> {
  const state = await readPromoLedger(dataDir);
  const postedAt = input.postedAt ?? new Date(input.nowMs ?? Date.now()).toISOString();
  state.entries.push({
    postedAt,
    intensity: input.intensity,
    jobId: input.jobId,
    subreddit: input.subreddit?.replace(/^r\//i, "").trim() || undefined,
  });
  state.entries = pruneEntries(
    state.entries,
    input.windowDays,
    input.nowMs ?? Date.now()
  );
  await writePromoLedger(dataDir, state);
  return state.entries.length;
}

export function pruneEntries(
  entries: PromoLedgerEntry[],
  windowDays: number,
  nowMs = Date.now()
): PromoLedgerEntry[] {
  if (windowDays <= 0) return entries;
  const cutoff = nowMs - windowDays * MS_PER_DAY;
  return entries.filter((e) => {
    const t = Date.parse(e.postedAt);
    return Number.isFinite(t) && t >= cutoff;
  });
}

export function evaluatePromoRatio(input: {
  enabled: boolean;
  maxRatio: number;
  windowDays: number;
  onExceed: PromoOnExceed;
  entries: PromoLedgerEntry[];
  /** Intensity we are about to draft / post (0 = help). */
  proposedIntensity: PromoIntensity;
  nowMs?: number;
}): PromoRatioStatus {
  const {
    enabled,
    maxRatio,
    windowDays,
    onExceed,
    proposedIntensity,
  } = input;
  const nowMs = input.nowMs ?? Date.now();
  const inWindow = pruneEntries(input.entries, windowDays, nowMs);
  const helpCount = inWindow.filter((e) => e.intensity === 0).length;
  const promoCount = inWindow.filter((e) => e.intensity > 0).length;
  const total = helpCount + promoCount;
  const currentRatio = total === 0 ? 0 : promoCount / total;

  const projectedPromo = promoCount + (proposedIntensity > 0 ? 1 : 0);
  const projectedTotal = total + 1;
  const projectedRatio = projectedPromo / projectedTotal;

  if (!enabled) {
    return {
      enabled: false,
      exceeds: false,
      blockPromo: false,
      warnPromo: false,
      onExceed,
      maxRatio,
      windowDays,
      helpCount,
      promoCount,
      currentRatio,
      projectedRatio,
      reasons: [],
    };
  }

  // Allow exactly maxRatio (e.g. 1/10 = 0.1); block when projected would go above.
  const exceeds =
    proposedIntensity > 0 && projectedRatio > maxRatio + Number.EPSILON;
  const reasons: string[] = [];
  if (exceeds) {
    reasons.push(
      `projected promo ratio ${(projectedRatio * 100).toFixed(1)}% > max ${(maxRatio * 100).toFixed(0)}% ` +
        `(${promoCount} promo / ${helpCount} help in ${windowDays}d; next would be ${projectedPromo}/${projectedTotal})`
    );
  }

  return {
    enabled: true,
    exceeds,
    blockPromo: exceeds && onExceed === "block",
    warnPromo: exceeds && onExceed === "warn",
    onExceed,
    maxRatio,
    windowDays,
    helpCount,
    promoCount,
    currentRatio,
    projectedRatio,
    reasons,
  };
}

/**
 * Load ledger + evaluate for a proposed intensity.
 * Pass proposedIntensity 1 to test whether a soft-mention is allowed.
 */
export async function resolvePromoRatioStatus(
  cfg: CommunityRuntimeConfig = getCommunityConfig(),
  opts?: {
    proposedIntensity?: PromoIntensity;
    nowMs?: number;
  }
): Promise<PromoRatioStatus> {
  const ledger = await readPromoLedger(cfg.reddit.dataDir);
  const proposed = opts?.proposedIntensity ?? 1;
  return evaluatePromoRatio({
    enabled: cfg.promo.enabled,
    maxRatio: cfg.promo.maxRatio,
    windowDays: cfg.promo.windowDays,
    onExceed: cfg.promo.onExceed,
    entries: ledger.entries,
    proposedIntensity: proposed,
    nowMs: opts?.nowMs,
  });
}

export function formatPromoRatioLog(status: PromoRatioStatus): string {
  if (!status.enabled) return "[promo] disabled";
  const ratioPct = (status.currentRatio * 100).toFixed(1);
  const base =
    `[promo] ratio=${ratioPct}% (${status.promoCount} promo / ${status.helpCount} help, ` +
    `${status.windowDays}d, max=${(status.maxRatio * 100).toFixed(0)}%, onExceed=${status.onExceed})`;
  if (status.exceeds) {
    return `${base} — EXCEEDS (${status.onExceed})${status.reasons[0] ? `: ${status.reasons[0]}` : ""}`;
  }
  return base;
}

function normalizeEntry(raw: unknown): PromoLedgerEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const postedAt = typeof row.postedAt === "string" ? row.postedAt : "";
  if (!postedAt || !Number.isFinite(Date.parse(postedAt))) return null;
  const n = Number(row.intensity);
  const intensity: PromoIntensity = n === 2 ? 2 : n === 1 ? 1 : 0;
  return {
    postedAt,
    intensity,
    jobId: typeof row.jobId === "string" ? row.jobId : undefined,
    subreddit:
      typeof row.subreddit === "string" && row.subreddit.trim()
        ? row.subreddit.replace(/^r\//i, "").trim()
        : undefined,
  };
}
