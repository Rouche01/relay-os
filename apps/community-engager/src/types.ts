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

export interface CommunityDraft {
  id: string;
  platform: CommunityPlatform;
  subreddit: string;
  threadUrl: string;
  threadTitle: string;
  /** OP body (selftext), trimmed and capped. Empty when the listing had none. */
  opText?: string;
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
