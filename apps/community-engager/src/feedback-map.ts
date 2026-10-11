import type { FeedbackContext, FeedbackDetail } from "@relay/protocol";
import type { CommunityDraft } from "./types.js";
import { scoreTotal } from "./types.js";
import type { WarmupStatus } from "./warmup.js";

/**
 * Map a community draft into the generic HITL FeedbackContext.
 * Adapters only need subjectId / title / body / url / details.
 */
export function draftToFeedbackContext(
  draft: CommunityDraft,
  opts?: { warmup?: WarmupStatus }
): FeedbackContext {
  const details: FeedbackDetail[] = [
    { label: "Subreddit", value: `r/${draft.subreddit}` },
    { label: "Score", value: `${scoreTotal(draft.score)}/5` },
    { label: "Intensity", value: String(draft.intensity) },
    { label: "Status", value: draft.status },
  ];
  if (opts?.warmup?.active) {
    details.push({
      label: "Warmup",
      value: opts.warmup.reasons.join("; ") || "active — intensity forced to 0",
    });
  }
  if (draft.rationale) {
    details.push({ label: "Rationale", value: draft.rationale });
  }

  return {
    subjectId: draft.id,
    title: draft.threadTitle,
    body: draft.draftText,
    url: draft.threadUrl,
    details,
    meta: {
      kind: "draft",
      platform: draft.platform,
      intensity: draft.intensity,
      score: draft.score,
      status: draft.status,
      utmCampaign: draft.utmCampaign,
      warmupActive: Boolean(opts?.warmup?.active),
    },
  };
}
