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
 * Copy-friendly notify body after draft accept in COMMUNITY_POST_MODE=manual.
 * Plain text (CLI / non-Telegram notify). Telegram uses the HITL card instead.
 */
export function formatManualPostNotify(draft: CommunityDraft): string {
  const score = scoreTotal(draft.score);
  const title = truncateTitle(draft.threadTitle);
  const permalink = draft.threadUrl.trim();
  const tone =
    draft.intensity === 0
      ? "help-only"
      : draft.intensity === 1
        ? "soft mention OK"
        : "disclosure + UTM";

  return (
    `Post on Reddit · r/${draft.subreddit}\n` +
    `${title}\n` +
    `${permalink}\n\n` +
    `Copy this reply:\n` +
    `────────\n` +
    `${draft.draftText.trim()}\n` +
    `────────\n\n` +
    `Paste it yourself — nothing is posted automatically.\n` +
    `(score ${score}/${SCORE_MAX} · ${tone})`
  );
}
