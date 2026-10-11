import type { FeedbackContext, FeedbackDetail } from "@relay/protocol";
import type { CommunityDraft } from "./types.js";
import { SCORE_MAX, scoreTotal } from "./types.js";
import type { CadenceStatus } from "./cadence.js";
import type { PromoRatioStatus } from "./promo-ratio.js";
import type { WarmupStatus } from "./warmup.js";
import {
  formatPlaybookSummary,
  type SubredditPlaybook,
} from "./playbook.js";

/**
 * Map a community draft into the generic HITL FeedbackContext.
 * Adapters only need subjectId / title / body / url / details.
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
  }
): FeedbackContext {
  const details: FeedbackDetail[] = [
    { label: "Subreddit", value: `r/${draft.subreddit}` },
    { label: "Score", value: `${scoreTotal(draft.score)}/${SCORE_MAX}` },
    { label: "Intensity", value: String(draft.intensity) },
    { label: "Status", value: draft.status },
  ];
  if (opts?.playbook) {
    details.push({
      label: "Playbook",
      value:
        formatPlaybookSummary(opts.playbook) +
        (opts.plugsThisWeek != null
          ? ` · plugsThisWeek=${opts.plugsThisWeek}`
          : "") +
        (opts.plugsWeekBlocked ? " · plugs capped" : ""),
    });
  }
  if (opts?.warmup?.active) {
    details.push({
      label: "Warmup",
      value: opts.warmup.reasons.join("; ") || "active — intensity forced to 0",
    });
  }
  if (opts?.promo?.exceeds) {
    const action =
      opts.promo.onExceed === "block"
        ? "blocked — intensity forced to 0"
        : "warning — soft mention still allowed";
    details.push({
      label: "Promo ratio",
      value:
        opts.promo.reasons.join("; ") ||
        `${(opts.promo.currentRatio * 100).toFixed(0)}% promo (${action})`,
    });
  } else if (opts?.promo?.enabled) {
    details.push({
      label: "Promo ratio",
      value: `${(opts.promo.currentRatio * 100).toFixed(1)}% (${opts.promo.promoCount} promo / ${opts.promo.helpCount} help, max ${(opts.promo.maxRatio * 100).toFixed(0)}%)`,
    });
  }
  if (opts?.cadence?.enabled) {
    const c = opts.cadence;
    details.push({
      label: "Cadence",
      value:
        `day ${c.dayKey} · help ${c.helpPostedToday}/${c.maxHelpPerDay}` +
        ` · promo ${c.promoPostedToday}/${c.maxPromoPerDay}` +
        (c.reasons.length ? ` · ${c.reasons.join("; ")}` : ""),
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
