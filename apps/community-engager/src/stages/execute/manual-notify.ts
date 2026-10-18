import type { CommunityDraft } from "../../types.js";
import { SCORE_MAX, scoreTotal } from "../../types.js";

const TITLE_MAX = 120;

/** Truncate title for Telegram / ops one-liners. */
export function truncateTitle(title: string, max = TITLE_MAX): string {
  const t = title.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * Copy-friendly notify body after Approve in COMMUNITY_POST_MODE=manual.
 * Plain text (works for Telegram notify + console).
 */
export function formatManualPostNotify(draft: CommunityDraft): string {
  const score = scoreTotal(draft.score);
  const title = truncateTitle(draft.threadTitle);
  const permalink = draft.threadUrl.trim();
  const intensityHint =
    draft.intensity === 0
      ? "help-only"
      : draft.intensity === 1
        ? "soft mention OK"
        : "disclosure + UTM";

  return (
    `📋 Manual post · r/${draft.subreddit}\n` +
    `Score ${score}/${SCORE_MAX} · intensity ${draft.intensity} (${intensityHint})\n` +
    `${title}\n` +
    `${permalink}\n\n` +
    `Suggested reply (copy/paste):\n` +
    `────────\n` +
    `${draft.draftText.trim()}\n` +
    `────────\n\n` +
    `Post this yourself on Reddit.\n` +
    `Approve already accepted this draft — no automated comment will be sent.\n` +
    `(Warmup / promo / cadence counters stay unchanged until a live auto post.)`
  );
}
