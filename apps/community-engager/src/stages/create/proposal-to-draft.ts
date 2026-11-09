import type { CommunityDraft, CreateProposal, OpportunityScore } from "../../types.js";

/** Synthetic help-shaped score so create proposals pass job gates that expect score. */
const CREATE_SCORE: OpportunityScore = {
  problemFit: true,
  wantsHelp: false,
  rulesOk: true,
  freshnessOk: true,
  valueWithoutApp: true,
  competition: true,
  icpFit: true,
  plugNaturalness: false,
};

/**
 * Map a create proposal into a {@link CommunityDraft} so jobs fanout / HITL /
 * manual-notify can reuse the reply pipeline (notify-only submit).
 */
export function createProposalToDraft(proposal: CreateProposal): CommunityDraft {
  const source = proposal.sourcePermalinks[0] ?? "";
  const opSnippet =
    `Pattern: ${proposal.patternSummary}` +
    (proposal.rationale ? `\nRationale: ${proposal.rationale}` : "") +
    (proposal.sourcePermalinks.length
      ? `\nSources:\n${proposal.sourcePermalinks.map((u) => `- ${u}`).join("\n")}`
      : "");

  return {
    id: proposal.id,
    kind: "create",
    platform: "reddit",
    subreddit: proposal.subreddit,
    threadTitle: proposal.title,
    threadUrl: source || `https://www.reddit.com/r/${proposal.subreddit}/submit`,
    opText: opSnippet,
    draftText: proposal.body,
    intensity: 0,
    score: CREATE_SCORE,
    rationale: proposal.rationale ?? proposal.patternSummary,
    status: proposal.status,
    createdAt: proposal.createdAt,
    draftProvider: proposal.draftProvider,
    draftModel: proposal.draftModel,
    redditThingId: proposal.sourcePostIds[0],
  };
}
