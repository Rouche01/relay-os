import type {
  DiscoverMode,
  OnEmptyScoutMode,
} from "../../reddit/config.js";
import type { ScoutReport } from "../scout/scout-report.js";

export interface EmptyScoutFallbackInput {
  onEmptyScout: OnEmptyScoutMode;
  discoverMode: DiscoverMode;
  onEmptyScoutMax: number;
  onEmptyScoutMaxPerDay: number;
  /** Fallback starts already recorded today (UTC day key). */
  dailyCount: number;
  /** Actionable drafts after scout. */
  opportunityCount: number;
  discoverRan: boolean;
  discoverSkipReason?: string;
  discoverEmptyScoutAttempts: number;
  /** Set after a fallback completes so we never chain. */
  discoverEmptyScoutFallbackDone?: boolean;
  excludedSeen: number;
  /** Unresolved scout interstitial / CAPTCHA hand-off. */
  hasChallenge: boolean;
  report: Pick<ScoutReport, "plannedSubs" | "subs">;
}

export interface EmptyScoutFallbackDecision {
  ok: boolean;
  reason: string;
}

/**
 * Whether engage should force one discover after an empty scout.
 * Pure predicate — caller supplies daily ledger count and context flags.
 */
export function shouldTriggerEmptyScoutFallback(
  input: EmptyScoutFallbackInput
): EmptyScoutFallbackDecision {
  if (input.onEmptyScout !== "force") {
    return { ok: false, reason: "onEmptyScout=off" };
  }
  if (input.discoverMode === "off") {
    return { ok: false, reason: "discover_mode=off" };
  }
  if (input.discoverEmptyScoutFallbackDone) {
    return { ok: false, reason: "fallback_already_done" };
  }
  if (input.opportunityCount > 0) {
    return { ok: false, reason: "has_opportunities" };
  }
  if (input.discoverRan) {
    return { ok: false, reason: "discover_already_ran" };
  }
  const skip = input.discoverSkipReason ?? "";
  if (!skip.startsWith("auto:healthy")) {
    return {
      ok: false,
      reason: skip
        ? `discover_skip_not_healthy:${skip}`
        : "discover_skip_missing",
    };
  }
  if (input.discoverEmptyScoutAttempts >= input.onEmptyScoutMax) {
    return {
      ok: false,
      reason: `run_cap:${input.discoverEmptyScoutAttempts}>=${input.onEmptyScoutMax}`,
    };
  }
  if (input.dailyCount >= input.onEmptyScoutMaxPerDay) {
    return {
      ok: false,
      reason: `day_cap:${input.dailyCount}>=${input.onEmptyScoutMaxPerDay}`,
    };
  }
  if (input.hasChallenge) {
    return { ok: false, reason: "unresolved_scout_challenge" };
  }

  const planned = input.report.plannedSubs.length;
  const subs = input.report.subs;
  const fetchedEmpty = subs.filter((s) => s.status === "empty").length;
  const hardFailAll =
    planned > 0 &&
    subs.length > 0 &&
    subs.every((s) => s.status === "blocked" || s.status === "timed_out");

  if (hardFailAll) {
    return { ok: false, reason: "hard_fail_all_subs" };
  }
  if (input.excludedSeen > 0 && fetchedEmpty === 0) {
    return { ok: false, reason: "empty_due_to_exclusions" };
  }
  if (fetchedEmpty < 1) {
    return { ok: false, reason: "no_fetched_empty_subs" };
  }

  return {
    ok: true,
    reason: `fallback:fetchedEmpty=${fetchedEmpty};attempts=${input.discoverEmptyScoutAttempts};day=${input.dailyCount}`,
  };
}

/** UTC calendar day key for the daily ledger (YYYY-MM-DD). */
export function emptyScoutFallbackUtcDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
