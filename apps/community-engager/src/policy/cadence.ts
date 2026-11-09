import {
  getCommunityConfig,
  type CommunityRuntimeConfig,
} from "../reddit/config.js";
import {
  readPromoLedger,
  type PromoLedgerEntry,
} from "./promo-ratio.js";
import type { EngageKind, PromoIntensity } from "../types.js";
import { engageKindOf, normalizeEngageKind } from "../types.js";

export interface CadenceStatus {
  enabled: boolean;
  maxHelpPerDay: number;
  maxPresencePerDay: number;
  maxPromoPerDay: number;
  maxCreatePerWeek: number;
  helpPostedToday: number;
  presencePostedToday: number;
  promoPostedToday: number;
  createPostedThisWeek: number;
  helpRemaining: number;
  presenceRemaining: number;
  promoRemaining: number;
  createRemaining: number;
  /** No more help or promo posts allowed today. */
  dayExhausted: boolean;
  helpExhausted: boolean;
  presenceExhausted: boolean;
  promoExhausted: boolean;
  createExhausted: boolean;
  reasons: string[];
  /** Local calendar day key used for the window (YYYY-MM-DD). */
  dayKey: string;
  /** ISO week key (YYYY-Www) for create caps. */
  weekKey: string;
}

/**
 * Count ledger posts that fall on the same local calendar day as `nowMs`.
 * Intensity-0 without kind (legacy) counts as help.
 */
export function countPostedToday(
  entries: ReadonlyArray<
    Pick<PromoLedgerEntry, "postedAt" | "intensity" | "kind">
  >,
  nowMs = Date.now()
): {
  help: number;
  presence: number;
  promo: number;
  dayKey: string;
} {
  const dayKey = localDayKey(nowMs);
  let help = 0;
  let presence = 0;
  let promo = 0;
  for (const e of entries) {
    const t = Date.parse(e.postedAt);
    if (!Number.isFinite(t)) continue;
    if (localDayKey(t) !== dayKey) continue;
    if ((e.intensity ?? 0) > 0) {
      promo += 1;
      continue;
    }
    const kind = normalizeEngageKind(e.kind);
    if (kind === "presence") presence += 1;
    else if (kind === "create") {
      /* create counted weekly, not daily help */
    } else help += 1;
  }
  return { help, presence, promo, dayKey };
}

export function countCreateThisWeek(
  entries: ReadonlyArray<Pick<PromoLedgerEntry, "postedAt" | "kind">>,
  nowMs = Date.now()
): { create: number; weekKey: string } {
  const weekKey = isoWeekKey(nowMs);
  let create = 0;
  for (const e of entries) {
    const t = Date.parse(e.postedAt);
    if (!Number.isFinite(t)) continue;
    if (isoWeekKey(t) !== weekKey) continue;
    if (normalizeEngageKind(e.kind) === "create") create += 1;
  }
  return { create, weekKey };
}

export function evaluateCadence(input: {
  enabled: boolean;
  maxHelpPerDay: number;
  maxPresencePerDay?: number;
  maxPromoPerDay: number;
  maxCreatePerWeek?: number;
  entries: ReadonlyArray<
    Pick<PromoLedgerEntry, "postedAt" | "intensity" | "kind">
  >;
  nowMs?: number;
}): CadenceStatus {
  const nowMs = input.nowMs ?? Date.now();
  const { help, presence, promo, dayKey } = countPostedToday(
    input.entries,
    nowMs
  );
  const { create, weekKey } = countCreateThisWeek(input.entries, nowMs);
  const maxHelp = Math.max(0, input.maxHelpPerDay);
  const maxPresence = Math.max(0, input.maxPresencePerDay ?? 2);
  const maxPromo = Math.max(0, input.maxPromoPerDay);
  const maxCreate = Math.max(0, input.maxCreatePerWeek ?? 1);

  if (!input.enabled) {
    return {
      enabled: false,
      maxHelpPerDay: maxHelp,
      maxPresencePerDay: maxPresence,
      maxPromoPerDay: maxPromo,
      maxCreatePerWeek: maxCreate,
      helpPostedToday: help,
      presencePostedToday: presence,
      promoPostedToday: promo,
      createPostedThisWeek: create,
      helpRemaining: maxHelp,
      presenceRemaining: maxPresence,
      promoRemaining: maxPromo,
      createRemaining: maxCreate,
      dayExhausted: false,
      helpExhausted: false,
      presenceExhausted: false,
      promoExhausted: false,
      createExhausted: false,
      reasons: [],
      dayKey,
      weekKey,
    };
  }

  const helpRemaining = Math.max(0, maxHelp - help);
  const presenceRemaining = Math.max(0, maxPresence - presence);
  const promoRemaining = Math.max(0, maxPromo - promo);
  const createRemaining = Math.max(0, maxCreate - create);
  const helpExhausted = helpRemaining <= 0;
  const presenceExhausted = presenceRemaining <= 0;
  const promoExhausted = promoRemaining <= 0;
  const createExhausted = createRemaining <= 0;
  const dayExhausted = helpExhausted && promoExhausted;
  const reasons: string[] = [];
  if (helpExhausted) {
    reasons.push(
      `help posts today ${help} ≥ max ${maxHelp} (day ${dayKey})`
    );
  }
  if (presenceExhausted) {
    reasons.push(
      `presence posts today ${presence} ≥ max ${maxPresence} (day ${dayKey})`
    );
  }
  if (promoExhausted) {
    reasons.push(
      `promo posts today ${promo} ≥ max ${maxPromo} (day ${dayKey})`
    );
  }
  if (createExhausted) {
    reasons.push(
      `create posts this week ${create} ≥ max ${maxCreate} (week ${weekKey})`
    );
  }

  return {
    enabled: true,
    maxHelpPerDay: maxHelp,
    maxPresencePerDay: maxPresence,
    maxPromoPerDay: maxPromo,
    maxCreatePerWeek: maxCreate,
    helpPostedToday: help,
    presencePostedToday: presence,
    promoPostedToday: promo,
    createPostedThisWeek: create,
    helpRemaining,
    presenceRemaining,
    promoRemaining,
    createRemaining,
    dayExhausted,
    helpExhausted,
    presenceExhausted,
    promoExhausted,
    createExhausted,
    reasons,
    dayKey,
    weekKey,
  };
}

/** Whether posting this intensity would exceed today's help/promo cadence. */
export function cadenceBlocksIntensity(
  status: CadenceStatus,
  intensity: PromoIntensity
): boolean {
  if (!status.enabled) return false;
  if (intensity > 0) return status.promoExhausted;
  return status.helpExhausted;
}

/** Lane-aware block (presence/create use their own budgets). */
export function cadenceBlocksLanePost(
  status: CadenceStatus,
  opts: { kind?: EngageKind | string | null; intensity: PromoIntensity }
): boolean {
  if (!status.enabled) return false;
  const kind = normalizeEngageKind(opts.kind);
  if (kind === "presence") return status.presenceExhausted;
  if (kind === "create") return status.createExhausted;
  return cadenceBlocksIntensity(status, opts.intensity);
}

export function formatCadenceLog(status: CadenceStatus): string {
  if (!status.enabled) return "[cadence] disabled";
  const flag = status.dayExhausted
    ? "EXHAUSTED"
    : status.helpExhausted ||
        status.presenceExhausted ||
        status.promoExhausted ||
        status.createExhausted
      ? "PARTIAL"
      : "ok";
  return (
    `[cadence] ${flag} day=${status.dayKey} ` +
    `help=${status.helpPostedToday}/${status.maxHelpPerDay} ` +
    `presence=${status.presencePostedToday}/${status.maxPresencePerDay} ` +
    `promo=${status.promoPostedToday}/${status.maxPromoPerDay} ` +
    `create=${status.createPostedThisWeek}/${status.maxCreatePerWeek}` +
    (status.reasons.length ? ` · ${status.reasons.join("; ")}` : "")
  );
}

/**
 * Cap opportunity list by remaining slots for the lane of the first item
 * (runs are single-kind). Falls back to help+promo when kinds are mixed/missing.
 */
export function trimOpportunitiesForCadence<T>(
  opportunities: T[],
  status: CadenceStatus
): T[] {
  if (!status.enabled) return opportunities;
  if (opportunities.length === 0) return opportunities;
  const head = opportunities[0] as { kind?: EngageKind | string | null };
  const kind = engageKindOf(head ?? {});
  let cap: number;
  if (kind === "presence") cap = status.presenceRemaining;
  else if (kind === "create") cap = status.createRemaining;
  else cap = status.helpRemaining + status.promoRemaining;
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
    maxPresencePerDay: cfg.cadence.maxPresencePerDay,
    maxPromoPerDay: cfg.cadence.maxPromoPerDay,
    maxCreatePerWeek: cfg.cadence.maxCreatePerWeek,
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

/** ISO week key YYYY-Www (Monday-based). */
export function isoWeekKey(ms: number): string {
  const d = new Date(ms);
  const utc = new Date(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  );
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7
  );
  return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
