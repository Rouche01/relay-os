/**
 * CommunityEngager domain types (draft queue + scoring).
 * App-local until a second consumer needs the same shapes.
 * Lifecycle status comes from @relay/action-store.
 */

import type { ActionStatus } from "@relay/action-store";

export type { ActionStatus };

/** Promo intensity for community drafts. Default to 0–1; 2 is rare. */
export type PromoIntensity = 0 | 1 | 2;

export type CommunityPlatform = "reddit";

/**
 * Engagement lane. Scout/draft/cadence are single-kind per entrypoint.
 * Missing/`undefined` on older drafts → treat as {@link DEFAULT_ENGAGE_KIND}.
 */
export type EngageKind = "help" | "presence" | "create";

export const DEFAULT_ENGAGE_KIND: EngageKind = "help";

const ENGAGE_KINDS = new Set<EngageKind>(["help", "presence", "create"]);

/** Parse lane kind; unknown / empty → help. */
export function normalizeEngageKind(raw?: string | null): EngageKind {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  return ENGAGE_KINDS.has(v as EngageKind)
    ? (v as EngageKind)
    : DEFAULT_ENGAGE_KIND;
}

/** Resolve kind on a draft (back-compat default help). */
export function engageKindOf(draft: {
  kind?: EngageKind | string | null;
}): EngageKind {
  return normalizeEngageKind(draft.kind);
}

/**
 * Opportunity score dimensions (equal weight 1 each).
 * Actionable when {@link scoreTotal} ≥ {@link ACTIONABLE_SCORE_MIN} (5/8).
 */
export interface OpportunityScore {
  /** Clear problem the product solves */
  problemFit: boolean;
  /** OP wants feedback / a system, not just brand recs */
  wantsHelp: boolean;
  /** Rules allow soft mention or founder disclosure */
  rulesOk: boolean;
  /** Thread is fresh enough */
  freshnessOk: boolean;
  /** Can help without the app first */
  valueWithoutApp: boolean;
  /** Thread still has room to contribute (low comment competition) */
  competition: boolean;
  /** Matches GoStylens ICP (wardrobe/system/planning, not haul/flex) */
  icpFit: boolean;
  /** Soft product mention / founder disclosure would feel natural */
  plugNaturalness: boolean;
}

/** Max {@link scoreTotal} (one point per dimension). */
export const SCORE_MAX = 8;

/**
 * Minimum total to enqueue (was ≥4/5; raised to ≥5/8 so new dimensions
 * actually filter duds while keeping similar strictness).
 */
export const ACTIONABLE_SCORE_MIN = 5;

/** Who produced draftText (LLM provider or stub fallback). */
export type DraftProvider = "gemini" | "anthropic" | "stub";

export interface CommunityDraft {
  id: string;
  platform: CommunityPlatform;
  subreddit: string;
  threadUrl: string;
  threadTitle: string;
  /**
   * Lane this opportunity belongs to. Default {@link DEFAULT_ENGAGE_KIND}
   * when omitted (legacy fixtures / older runs).
   */
  kind?: EngageKind;
  /** OP body (selftext), trimmed and capped. Empty when the listing had none. */
  opText?: string;
  /**
   * When set, OP post is photo/gallery-led (or deictic “these” with thin body).
   * Draft model must not invent garment details it cannot see.
   */
  opMediaHint?: string;
  /** Listing post.url (image CDN / gallery) when different from permalink. */
  postUrl?: string;
  draftText: string;
  intensity: PromoIntensity;
  score: OpportunityScore;
  rationale: string;
  /** Mirrors ActionRecord.status when persisted */
  status: ActionStatus;
  createdAt: string;
  utmCampaign?: string;
  /** Reddit fullname for the link (t3_…) when scouted live */
  redditThingId?: string;
  /** Set when draft stage fills draftText (gemini / anthropic / stub). */
  draftProvider?: DraftProvider;
  /** Versioned model id (e.g. gemini-2.5-flash) or "stub". */
  draftModel?: string;
}

/**
 * Top-level original-post proposal (create lane). Distinct from reply drafts;
 * pipeline lands in a later slice — shape is locked here for HITL/evidence.
 */
export interface CreateProposal {
  id: string;
  kind: "create";
  platform: CommunityPlatform;
  subreddit: string;
  title: string;
  body: string;
  /** Short pattern extracted from winner source(s). */
  patternSummary: string;
  /** Reddit fullnames (t3_…) for remodel sources. */
  sourcePostIds: string[];
  /** Permalinks for HITL / audit. */
  sourcePermalinks: string[];
  status: ActionStatus;
  createdAt: string;
  draftProvider?: DraftProvider;
  draftModel?: string;
  rationale?: string;
}

export function scoreTotal(score: OpportunityScore): number {
  return (
    Number(score.problemFit) +
    Number(score.wantsHelp) +
    Number(score.rulesOk) +
    Number(score.freshnessOk) +
    Number(score.valueWithoutApp) +
    Number(score.competition) +
    Number(score.icpFit) +
    Number(score.plugNaturalness)
  );
}

/** Act only when ≥ {@link ACTIONABLE_SCORE_MIN}/{@link SCORE_MAX}. */
export function isActionable(score: OpportunityScore): boolean {
  return scoreTotal(score) >= ACTIONABLE_SCORE_MIN;
}
