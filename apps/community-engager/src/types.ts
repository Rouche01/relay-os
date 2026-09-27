/**
 * CommunityEngager domain types (draft queue + scoring).
 * App-local until a second consumer needs the same shapes.
 */

/** Promo intensity for community drafts. Default to 0–1; 2 is rare. */
export type PromoIntensity = 0 | 1 | 2;

export type ActionStatus =
  | "proposed"
  | "pending_approval"
  | "approved"
  | "edited"
  | "aborted"
  | "posted"
  | "failed";

export type CommunityPlatform = "reddit";

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
}

export interface CommunityDraft {
  id: string;
  platform: CommunityPlatform;
  subreddit: string;
  threadUrl: string;
  threadTitle: string;
  draftText: string;
  intensity: PromoIntensity;
  score: OpportunityScore;
  rationale: string;
  status: ActionStatus;
  createdAt: string;
  utmCampaign?: string;
}

export function scoreTotal(score: OpportunityScore): number {
  return (
    Number(score.problemFit) +
    Number(score.wantsHelp) +
    Number(score.rulesOk) +
    Number(score.freshnessOk) +
    Number(score.valueWithoutApp)
  );
}

/** Act only when ≥ 4/5. */
export function isActionable(score: OpportunityScore): boolean {
  return scoreTotal(score) >= 4;
}
