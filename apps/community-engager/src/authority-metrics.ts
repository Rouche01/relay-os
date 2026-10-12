/**
 * Authority north-star metrics from local ledgers (promo, visibility, post-watch, attribution).
 * Admin surfaces these; product analytics join remains optional via activations import.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { readPromoLedger, type PromoLedgerEntry } from "./promo-ratio.js";
import {
  readPostWatchQueue,
  type PostWatchEntry,
} from "./post-watch.js";
import type { VisibilityCheckResult } from "./visibility.js";
import type { AttributionRecord } from "./attribution.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_PROMO_MAX = 0.1;

export interface ActivationsImport {
  /** Manually pasted / nightly import from GoStylens Reddit-attributed signups. */
  count: number;
  updatedAt?: string;
  notes?: string;
}

export interface AuthorityScoreCard {
  computedAt: string;
  windowDays: number;
  /** Rolling promo/(help+promo) in the window. */
  promoRatio: number;
  helpCount: number;
  promoCount: number;
  /** Public visibility ok / checked (from visibility/*.json). */
  visibilityRate: number;
  visibilityOk: number;
  visibilityChecked: number;
  /** Replied / settled watches (replied + removed + expired). */
  replyRate: number;
  replied: number;
  settled: number;
  removed: number;
  /** Live attribution ledger rows (LP join keys written). */
  attributionJobs: number;
  /** Imported Reddit-attributed activations (default 0 until product join). */
  attributedActivations: number;
  activationsUpdatedAt?: string;
  /**
   * Glance score: visibility × replyRate × (1 − promoRatio) × max(1, activations).
   * When activations are still 0, uses the three-way health product only.
   */
  score: number;
  /** Same as score but always multiplies activations (0 → score 0). */
  scoreWithActivations: number;
  constraints: {
    promoOk: boolean;
    visibilityHealthy: boolean;
    replyHealthy: boolean;
  };
}

export function evaluateAuthorityScore(input: {
  promoEntries: ReadonlyArray<Pick<PromoLedgerEntry, "postedAt" | "intensity">>;
  visibilityResults: ReadonlyArray<
    Pick<VisibilityCheckResult, "visibilityOk" | "status" | "checkedAt">
  >;
  watches: ReadonlyArray<Pick<PostWatchEntry, "status">>;
  attributionJobs: number;
  attributedActivations: number;
  windowDays?: number;
  promoMaxRatio?: number;
  nowMs?: number;
  activationsUpdatedAt?: string;
}): AuthorityScoreCard {
  const nowMs = input.nowMs ?? Date.now();
  const windowDays = Math.max(1, input.windowDays ?? 30);
  const promoMax = input.promoMaxRatio ?? DEFAULT_PROMO_MAX;
  const cutoff = nowMs - windowDays * MS_PER_DAY;

  let helpCount = 0;
  let promoCount = 0;
  for (const e of input.promoEntries) {
    const t = Date.parse(e.postedAt);
    if (!Number.isFinite(t) || t < cutoff) continue;
    if ((e.intensity ?? 0) > 0) promoCount += 1;
    else helpCount += 1;
  }
  const posted = helpCount + promoCount;
  const promoRatio = posted === 0 ? 0 : promoCount / posted;

  let visibilityOk = 0;
  let visibilityChecked = 0;
  for (const v of input.visibilityResults) {
    if (v.status === "skipped") continue;
    const t = Date.parse(v.checkedAt);
    if (Number.isFinite(t) && t < cutoff) continue;
    visibilityChecked += 1;
    if (v.visibilityOk) visibilityOk += 1;
  }
  const visibilityRate =
    visibilityChecked === 0 ? 1 : visibilityOk / visibilityChecked;

  let replied = 0;
  let removed = 0;
  let expired = 0;
  for (const w of input.watches) {
    if (w.status === "replied") replied += 1;
    else if (w.status === "removed") removed += 1;
    else if (w.status === "expired") expired += 1;
  }
  const settled = replied + removed + expired;
  const replyRate = settled === 0 ? 0 : replied / settled;

  const attributedActivations = Math.max(0, input.attributedActivations);
  const health =
    clamp01(visibilityRate) * clamp01(replyRate) * clamp01(1 - promoRatio);
  const scoreWithActivations = health * attributedActivations;
  const score =
    attributedActivations > 0 ? scoreWithActivations : health;

  return {
    computedAt: new Date(nowMs).toISOString(),
    windowDays,
    promoRatio,
    helpCount,
    promoCount,
    visibilityRate,
    visibilityOk,
    visibilityChecked,
    replyRate,
    replied,
    settled,
    removed,
    attributionJobs: Math.max(0, input.attributionJobs),
    attributedActivations,
    activationsUpdatedAt: input.activationsUpdatedAt,
    score,
    scoreWithActivations,
    constraints: {
      promoOk: promoRatio <= promoMax + 1e-9,
      visibilityHealthy: visibilityRate >= 0.8 || visibilityChecked === 0,
      replyHealthy: replyRate >= 0.2 || settled === 0,
    },
  };
}

export async function resolveAuthorityScoreCard(
  dataDir: string,
  opts?: { windowDays?: number; promoMaxRatio?: number; nowMs?: number }
): Promise<AuthorityScoreCard> {
  const [ledger, watches, visibilityResults, attributionJobs, activations] =
    await Promise.all([
      readPromoLedger(dataDir),
      readPostWatchQueue(dataDir).then((q) => q.watches),
      listVisibilityResults(dataDir),
      countAttributionJobs(dataDir),
      readActivationsImport(dataDir),
    ]);

  return evaluateAuthorityScore({
    promoEntries: ledger.entries,
    visibilityResults,
    watches,
    attributionJobs,
    attributedActivations: activations.count,
    activationsUpdatedAt: activations.updatedAt,
    windowDays: opts?.windowDays,
    promoMaxRatio: opts?.promoMaxRatio,
    nowMs: opts?.nowMs,
  });
}

export function formatAuthorityLog(card: AuthorityScoreCard): string {
  return (
    `[authority] score=${card.score.toFixed(3)} ` +
    `promo=${(card.promoRatio * 100).toFixed(1)}% ` +
    `vis=${(card.visibilityRate * 100).toFixed(0)}% ` +
    `reply=${(card.replyRate * 100).toFixed(0)}% ` +
    `activations=${card.attributedActivations}` +
    (card.constraints.promoOk ? "" : " PROMO_HIGH") +
    (card.constraints.visibilityHealthy ? "" : " VIS_LOW") +
    (card.constraints.replyHealthy ? "" : " REPLY_LOW")
  );
}

async function listVisibilityResults(
  dataDir: string
): Promise<VisibilityCheckResult[]> {
  const dir = path.join(dataDir, "visibility");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw err;
  }
  const out: VisibilityCheckResult[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await readFile(path.join(dir, name), "utf8");
      out.push(JSON.parse(raw) as VisibilityCheckResult);
    } catch {
      /* skip */
    }
  }
  return out;
}

async function countAttributionJobs(dataDir: string): Promise<number> {
  const dir = path.join(dataDir, "attribution");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return 0;
    throw err;
  }
  let n = 0;
  for (const name of names) {
    if (name === "activations.json" || !name.endsWith(".json")) continue;
    try {
      const raw = await readFile(path.join(dir, name), "utf8");
      const rec = JSON.parse(raw) as AttributionRecord;
      if (rec.dryRun) continue;
      n += 1;
    } catch {
      /* skip */
    }
  }
  return n;
}

export async function readActivationsImport(
  dataDir: string
): Promise<ActivationsImport> {
  const file = path.join(dataDir, "attribution", "activations.json");
  try {
    const raw = await readFile(file, "utf8");
    const data = JSON.parse(raw) as ActivationsImport;
    const count = Number(data.count);
    return {
      count: Number.isFinite(count) && count > 0 ? Math.floor(count) : 0,
      updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : undefined,
      notes: typeof data.notes === "string" ? data.notes : undefined,
    };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { count: 0 };
    }
    throw err;
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
