import type { PromoLedgerEntry } from "./promo-ratio.js";
import type { PromoIntensity } from "./types.js";

/** How hard a product plug may go on this sub. */
export type PlugStyle = "none" | "mention" | "disclose_link";

/** Megathread / WAYWT / daily questions policy. */
export type MegathreadPolicy = "skip" | "help_only" | "allow";

/**
 * Per-subreddit operational playbook (lives on allowlist entries + seed policy).
 */
export interface SubredditPlaybook {
  /** Short rules summary for HITL / drafter. */
  rulesSummary: string;
  /** Max plug style allowed (maps to intensity ceiling). */
  plugStyle: PlugStyle;
  /** How to treat megathreads / WAYWT / daily questions. */
  megathreadPolicy: MegathreadPolicy;
  /** Cap intensity ≥1 live posts per rolling 7 days on this sub. */
  maxPlugsPerWeek: number;
}

export const DEFAULT_PLAYBOOK: SubredditPlaybook = {
  rulesSummary: "Help-first; soft mention only when natural; no hard links.",
  plugStyle: "mention",
  megathreadPolicy: "skip",
  maxPlugsPerWeek: 1,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Loose input — aliases like "disclose" / "help" accepted via parsers. */
export type PlaybookInput = {
  rulesSummary?: string;
  plugStyle?: string | PlugStyle;
  megathreadPolicy?: string | MegathreadPolicy;
  maxPlugsPerWeek?: number;
};

export function normalizePlaybook(
  raw?: PlaybookInput | Partial<SubredditPlaybook> | null,
  fallbackSummary?: string
): SubredditPlaybook {
  const base = { ...DEFAULT_PLAYBOOK };
  if (fallbackSummary?.trim()) base.rulesSummary = fallbackSummary.trim();
  if (!raw || typeof raw !== "object") return base;

  const summary =
    typeof raw.rulesSummary === "string" && raw.rulesSummary.trim()
      ? raw.rulesSummary.trim()
      : base.rulesSummary;
  return {
    rulesSummary: summary,
    plugStyle: parsePlugStyle(raw.plugStyle) ?? base.plugStyle,
    megathreadPolicy:
      parseMegathreadPolicy(raw.megathreadPolicy) ?? base.megathreadPolicy,
    maxPlugsPerWeek: nonNegInt(raw.maxPlugsPerWeek, base.maxPlugsPerWeek),
  };
}

export function parsePlugStyle(raw: unknown): PlugStyle | undefined {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (v === "none" || v === "0" || v === "help") return "none";
  if (v === "mention" || v === "1" || v === "soft") return "mention";
  if (
    v === "disclose_link" ||
    v === "disclose" ||
    v === "link" ||
    v === "2"
  ) {
    return "disclose_link";
  }
  return undefined;
}

export function parseMegathreadPolicy(raw: unknown): MegathreadPolicy | undefined {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (v === "skip" || v === "off" || v === "false") return "skip";
  if (v === "help_only" || v === "help" || v === "help-only") return "help_only";
  if (v === "allow" || v === "on" || v === "true") return "allow";
  return undefined;
}

export function maxIntensityForPlugStyle(style: PlugStyle): PromoIntensity {
  if (style === "disclose_link") return 2;
  if (style === "mention") return 1;
  return 0;
}

/**
 * Clamp draft intensity to playbook (+ megathread help_only → 0).
 */
export function clampIntensityToPlaybook(
  intensity: PromoIntensity,
  playbook: SubredditPlaybook,
  opts?: { isMegathread?: boolean }
): PromoIntensity {
  let max = maxIntensityForPlugStyle(playbook.plugStyle);
  if (opts?.isMegathread && playbook.megathreadPolicy === "help_only") {
    max = 0;
  }
  const n = intensity === 2 ? 2 : intensity === 1 ? 1 : 0;
  return (n > max ? max : n) as PromoIntensity;
}

/** Whether a megathread should enter the scout pipeline for this playbook. */
export function shouldScoutMegathread(
  isMega: boolean,
  playbook: SubredditPlaybook
): boolean {
  if (!isMega) return true;
  return playbook.megathreadPolicy !== "skip";
}

/** Seed / default playbook for a sub name (uses ALLOWLISTED_SUBREDDITS when present). */
export function seedPlaybookFor(
  name: string,
  seed?: { playbook?: Partial<SubredditPlaybook>; note?: string }
): SubredditPlaybook {
  return normalizePlaybook(seed?.playbook, seed?.note);
}

/** Count intensity ≥1 posts for a sub in the last 7 days. */
export function countPlugsThisWeek(
  entries: ReadonlyArray<Pick<PromoLedgerEntry, "postedAt" | "intensity" | "subreddit">>,
  subreddit: string,
  nowMs = Date.now()
): number {
  const sub = subreddit.replace(/^r\//i, "").toLowerCase();
  const cutoff = nowMs - 7 * MS_PER_DAY;
  return entries.filter((e) => {
    if ((e.intensity ?? 0) < 1) return false;
    if ((e.subreddit ?? "").replace(/^r\//i, "").toLowerCase() !== sub) {
      return false;
    }
    const t = Date.parse(e.postedAt);
    return Number.isFinite(t) && t >= cutoff;
  }).length;
}

/**
 * When maxPlugsPerWeek is 0, any intensity ≥1 is blocked.
 * When > 0, block once this week's plug count has already reached the max.
 */
export function shouldBlockPlugForWeek(
  playbook: SubredditPlaybook,
  plugsThisWeek: number
): boolean {
  if (playbook.plugStyle === "none") return true;
  if (playbook.maxPlugsPerWeek <= 0) return true;
  return plugsThisWeek >= playbook.maxPlugsPerWeek;
}

export function formatPlaybookSummary(playbook: SubredditPlaybook): string {
  return (
    `plug=${playbook.plugStyle} mega=${playbook.megathreadPolicy} ` +
    `maxPlugs/wk=${playbook.maxPlugsPerWeek} · ${playbook.rulesSummary}`
  );
}

/** Lookup helper for scout mappers (sub names may be prefixed with r/). */
export function playbookLookup(
  map: Map<string, SubredditPlaybook>
): (subreddit: string) => SubredditPlaybook {
  return (subreddit: string) => {
    const key = subreddit.replace(/^r\//i, "").toLowerCase();
    return map.get(key) ?? DEFAULT_PLAYBOOK;
  };
}

function nonNegInt(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}
