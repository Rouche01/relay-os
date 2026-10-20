import type { FeedbackContext, FeedbackDetail } from "@relay/protocol";
import type { CommunityDraft } from "../types.js";
import { SCORE_MAX, scoreTotal } from "../types.js";
import type { CadenceStatus } from "../policy/cadence.js";
import type { PromoRatioStatus } from "../policy/promo-ratio.js";
import type { WarmupStatus } from "../policy/warmup.js";
import type { PostMode } from "../reddit/config.js";
import type { SubredditPlaybook } from "../policy/playbook.js";

/**
 * Map a community draft into the generic HITL FeedbackContext.
 * Adapters only need subjectId / title / body / url / details.
 *
 * Keep details short — Telegram cards lead with the draft; long rationale /
 * status walls raise cognitive load.
 */
export function draftToFeedbackContext(
  draft: CommunityDraft,
  opts?: {
    warmup?: WarmupStatus;
    promo?: PromoRatioStatus;
    cadence?: CadenceStatus;
    playbook?: SubredditPlaybook;
    plugsThisWeek?: number;
    plugsWeekBlocked?: boolean;
    /** When manual, card is copy-paste notify (no Approve→execute). */
    postMode?: PostMode;
  }
): FeedbackContext {
  const manual = opts?.postMode === "manual";
  const details: FeedbackDetail[] = [
    { label: "Subreddit", value: `r/${draft.subreddit}` },
    { label: "Score", value: `${scoreTotal(draft.score)}/${SCORE_MAX}` },
  ];

  if (!manual) {
    details.push({ label: "Intensity", value: String(draft.intensity) });
  }

  // Guards only when they change what you should post (not full ledgers).
  if (opts?.warmup?.active) {
    details.push({
      label: "Warmup",
      value: opts.warmup.reasons[0] ?? "help-only until warmup clears",
    });
  }
  if (opts?.promo?.exceeds || opts?.promo?.blockPromo) {
    details.push({
      label: "Promo ratio",
      value:
        opts.promo.onExceed === "block"
          ? "promo blocked — keep help-only"
          : "promo soft-cap — prefer help-only",
    });
  }
  if (opts?.plugsWeekBlocked) {
    details.push({
      label: "Playbook",
      value: "plugs capped this week — help-only",
    });
  }

  // Auto mode: short intensity-2 hint only (confirmation step follows).
  if (!manual && draft.intensity >= 2) {
    details.push({
      label: "Hint",
      value: "Intensity 2 — confirm disclosure + UTM before post.",
    });
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
      postMode: opts?.postMode ?? "auto",
      warmupActive: Boolean(opts?.warmup?.active),
      promoBlocked: Boolean(opts?.promo?.blockPromo),
      promoWarned: Boolean(opts?.promo?.warnPromo),
      promoRatio: opts?.promo?.currentRatio,
      cadenceHelpRemaining: opts?.cadence?.helpRemaining,
      cadencePromoRemaining: opts?.cadence?.promoRemaining,
      playbookPlugStyle: opts?.playbook?.plugStyle,
      plugsWeekBlocked: Boolean(opts?.plugsWeekBlocked),
    },
  };
}
