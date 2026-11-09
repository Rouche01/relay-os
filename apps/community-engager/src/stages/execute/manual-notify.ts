import type { CommunityDraft } from "../../types.js";
import { draftScoreSummary, engageKindOf } from "../../types.js";

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
  const { total: score, max: scoreMax } = draftScoreSummary(draft);
  const title = truncateTitle(draft.threadTitle);
  const permalink = draft.threadUrl.trim();
  const kind = engageKindOf(draft);

  if (kind === "create") {
    return (
      `Create original post · r/${draft.subreddit}\n` +
      `Title: ${title}\n\n` +
      `Copy this body:\n` +
      `────────\n` +
      `${draft.draftText.trim()}\n` +
      `────────\n\n` +
      (draft.opText ? `${draft.opText.trim()}\n\n` : "") +
      `Submit yourself on Reddit — nothing is posted automatically.\n` +
      `(lane create · notify-only)`
    );
  }

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
    `(lane ${kind} · score ${score}/${scoreMax} · ${tone})`
  );
}
