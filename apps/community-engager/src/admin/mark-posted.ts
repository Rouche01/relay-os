/**
 * Mark a manual Reddit comment as posted and enroll post-watch.
 * Used by admin Actions → mark_posted (not on every payload save).
 */
import type { ActionRecord, ActionStore } from "@relay/action-store";
import { getCommunityConfig } from "../reddit/config.js";
import { enrollPostWatch } from "../stages/post-watch/post-watch.js";

export interface MarkPostedResult {
  record: ActionRecord;
  watchId: string;
  checkAfter: string;
  expiresAt: string;
  alreadyPosted: boolean;
}

function payloadOf(record: ActionRecord): Record<string, unknown> {
  return record.payload &&
    typeof record.payload === "object" &&
    !Array.isArray(record.payload)
    ? (record.payload as Record<string, unknown>)
    : {};
}

/** Normalize / validate a Reddit comment permalink. */
export function normalizeCommentPermalink(raw: string): string {
  const url = raw.trim();
  if (!url) {
    throw new Error("postedUrl is required (Reddit comment permalink)");
  }
  if (!/^https?:\/\//i.test(url) && !url.startsWith("/")) {
    throw new Error(
      "postedUrl must be a full https://www.reddit.com/... comment link"
    );
  }
  const absolute = url.startsWith("http")
    ? url
    : `https://www.reddit.com${url.startsWith("/") ? "" : "/"}${url}`;
  if (!/reddit\.com\//i.test(absolute)) {
    throw new Error("postedUrl must be a reddit.com permalink");
  }
  // Prefer comment deep links; thread-only still enrolls but reply detection is weaker.
  return absolute.split("?")[0]!.replace(/\/$/, "");
}

/**
 * Set status=posted, persist postedUrl + postedAt, enroll two-phase post-watch.
 */
export async function markActionPostedAndWatch(
  store: ActionStore,
  actionId: string,
  opts: {
    postedUrl: string;
    dataDir?: string;
    nowMs?: number;
  }
): Promise<MarkPostedResult> {
  const current = await store.get(actionId);
  if (!current) {
    throw new Error(`Action not found: ${actionId}`);
  }

  const postedUrl = normalizeCommentPermalink(opts.postedUrl);
  const p = payloadOf(current);
  const subreddit =
    typeof p.subreddit === "string" ? p.subreddit.replace(/^r\//i, "") : "";
  const threadUrl =
    typeof p.threadUrl === "string" && p.threadUrl.trim()
      ? p.threadUrl.trim()
      : postedUrl;
  const threadTitle =
    typeof p.threadTitle === "string" && p.threadTitle.trim()
      ? p.threadTitle.trim()
      : actionId;

  if (!subreddit) {
    throw new Error("Action payload missing subreddit — cannot enroll watch");
  }

  const cfg = getCommunityConfig();
  const dataDir = opts.dataDir ?? cfg.reddit.dataDir;
  const nowMs = opts.nowMs ?? Date.now();
  const postedAt = new Date(nowMs).toISOString();
  const alreadyPosted = current.status === "posted";

  const nextStatus = alreadyPosted ? "posted" : "posted";
  // approved|edited → posted; already posted stays posted (assertTransition allows same).
  if (
    current.status !== "posted" &&
    current.status !== "approved" &&
    current.status !== "edited"
  ) {
    throw new Error(
      `Cannot mark_posted from status "${current.status}" (need approved, edited, or posted)`
    );
  }

  const record = await store.updateStatus(actionId, nextStatus, {
    payload: {
      status: "posted",
      postedUrl,
      postedAt,
      postMode: "manual",
    },
  });

  const watch = await enrollPostWatch(dataDir, {
    postedUrl,
    subreddit,
    threadUrl,
    threadTitle,
    draftId: actionId,
    jobId:
      typeof p.executeJobId === "string"
        ? p.executeJobId
        : typeof p.jobId === "string"
          ? p.jobId
          : undefined,
    firstCheckAfterHours: cfg.postWatch.firstCheckAfterHours,
    maxAgeHours: cfg.postWatch.maxAgeHours,
    nowMs,
  });

  return {
    record,
    watchId: watch.id,
    checkAfter: watch.checkAfter,
    expiresAt: watch.expiresAt,
    alreadyPosted,
  };
}
