import {
  getCommunityConfig,
  type CommunityRuntimeConfig,
} from "../reddit/config.js";
import {
  readPromoLedger,
  type PromoLedgerEntry,
} from "./promo-ratio.js";
import type { PromoIntensity } from "../types.js";

export interface CadenceStatus {
  enabled: boolean;
  maxHelpPerDay: number;
  maxPromoPerDay: number;
  helpPostedToday: number;
  promoPostedToday: number;
  helpRemaining: number;
  promoRemaining: number;
  /** No more posts (help or promo) allowed today. */
  dayExhausted: boolean;
  helpExhausted: boolean;
  promoExhausted: boolean;
  reasons: string[];
  /** Local calendar day key used for the window (YYYY-MM-DD). */
  dayKey: string;
}

/**
 * Count ledger posts that fall on the same local calendar day as `nowMs`.
 */
export function countPostedToday(
  entries: ReadonlyArray<Pick<PromoLedgerEntry, "postedAt" | "intensity">>,
  nowMs = Date.now()
): { help: number; promo: number; dayKey: string } {
  const dayKey = localDayKey(nowMs);
  let help = 0;
  let promo = 0;
  for (const e of entries) {
    const t = Date.parse(e.postedAt);
    if (!Number.isFinite(t)) continue;
    if (localDayKey(t) !== dayKey) continue;
    if ((e.intensity ?? 0) > 0) promo += 1;
    else help += 1;
  }
  return { help, promo, dayKey };
}

export function evaluateCadence(input: {
  enabled: boolean;
  maxHelpPerDay: number;
  maxPromoPerDay: number;
  entries: ReadonlyArray<Pick<PromoLedgerEntry, "postedAt" | "intensity">>;
  nowMs?: number;
}): CadenceStatus {
  const nowMs = input.nowMs ?? Date.now();
  const { help, promo, dayKey } = countPostedToday(input.entries, nowMs);
  const maxHelp = Math.max(0, input.maxHelpPerDay);
  const maxPromo = Math.max(0, input.maxPromoPerDay);

  if (!input.enabled) {
    return {
      enabled: false,
      maxHelpPerDay: maxHelp,
      maxPromoPerDay: maxPromo,
      helpPostedToday: help,
      promoPostedToday: promo,
      helpRemaining: maxHelp,
      promoRemaining: maxPromo,
      dayExhausted: false,
      helpExhausted: false,
      promoExhausted: false,
      reasons: [],
      dayKey,
    };
  }

  const helpRemaining = Math.max(0, maxHelp - help);
  const promoRemaining = Math.max(0, maxPromo - promo);
  const helpExhausted = helpRemaining <= 0;
  const promoExhausted = promoRemaining <= 0;
  const dayExhausted = helpExhausted && promoExhausted;
  const reasons: string[] = [];
  if (helpExhausted) {
    reasons.push(
      `help posts today ${help} ≥ max ${maxHelp} (day ${dayKey})`
    );
  }
  if (promoExhausted) {
    reasons.push(
      `promo posts today ${promo} ≥ max ${maxPromo} (day ${dayKey})`
    );
  }

  return {
    enabled: true,
    maxHelpPerDay: maxHelp,
    maxPromoPerDay: maxPromo,
    helpPostedToday: help,
    promoPostedToday: promo,
    helpRemaining,
    promoRemaining,
    dayExhausted,
    helpExhausted,
    promoExhausted,
    reasons,
    dayKey,
  };
}

/** Whether posting this intensity would exceed today's cadence. */
export function cadenceBlocksIntensity(
  status: CadenceStatus,
  intensity: PromoIntensity
): boolean {
  if (!status.enabled) return false;
  if (intensity > 0) return status.promoExhausted;
  return status.helpExhausted;
}

export function formatCadenceLog(status: CadenceStatus): string {
  if (!status.enabled) return "[cadence] disabled";
  const flag = status.dayExhausted
    ? "EXHAUSTED"
    : status.helpExhausted || status.promoExhausted
      ? "PARTIAL"
      : "ok";
  return (
    `[cadence] ${flag} day=${status.dayKey} ` +
    `help=${status.helpPostedToday}/${status.maxHelpPerDay} ` +
    `promo=${status.promoPostedToday}/${status.maxPromoPerDay}` +
    (status.reasons.length ? ` · ${status.reasons.join("; ")}` : "")
  );
}

/**
 * Cap opportunity list by remaining daily post slots (help + promo).
 */
export function trimOpportunitiesForCadence<T>(
  opportunities: T[],
  status: CadenceStatus
): T[] {
  if (!status.enabled) return opportunities;
  const cap = status.helpRemaining + status.promoRemaining;
  if (cap <= 0) return [];
  if (opportunities.length <= cap) return opportunities;
  return opportunities.slice(0, cap);
}

export async function resolveCadenceStatus(
  cfg: CommunityRuntimeConfig = getCommunityConfig(),
  opts?: { nowMs?: number }
): Promise<CadenceStatus> {
  const ledger = await readPromoLedger(cfg.reddit.dataDir);
  return evaluateCadence({
    enabled: cfg.cadence.enabled,
    maxHelpPerDay: cfg.cadence.maxHelpPerDay,
    maxPromoPerDay: cfg.cadence.maxPromoPerDay,
    entries: ledger.entries,
    nowMs: opts?.nowMs,
  });
}

export function localDayKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
