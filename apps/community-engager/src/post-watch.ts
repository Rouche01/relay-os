import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getCommunityConfig,
  type CommunityRuntimeConfig,
} from "./reddit/config.js";
import {
  commentIdFromPermalink,
  fetchRedditComment,
} from "./reddit/comment-fetch.js";
import type { CommunityDraft, PromoIntensity } from "./types.js";

export type PostWatchStatus =
  | "pending"
  | "replied"
  | "removed"
  | "expired"
  | "error";

export interface PostWatchEntry {
  id: string;
  enrolledAt: string;
  /** First eligible check time (enrolledAt + minAgeHours). */
  checkAfter: string;
  /** Stop polling after this (enrolledAt + maxAgeHours). */
  expiresAt: string;
  subreddit: string;
  threadUrl: string;
  threadTitle: string;
  /** Permalink of our posted comment. */
  postedUrl: string;
  commentId?: string;
  draftId?: string;
  jobId?: string;
  status: PostWatchStatus;
  lastCheckedAt?: string;
  replyCount?: number;
  /** Follow-up opportunity id when queued. */
  followUpDraftId?: string;
  lastError?: string;
}

export interface PostWatchQueue {
  watches: PostWatchEntry[];
  updatedAt: string;
}

export interface PostWatchProcessResult {
  checked: number;
  replied: number;
  removed: number;
  expired: number;
  errors: number;
  followUps: CommunityDraft[];
}

const MS_PER_HOUR = 60 * 60 * 1000;

export function postWatchQueuePath(dataDir: string): string {
  return path.join(dataDir, "post-watch", "queue.json");
}

export async function readPostWatchQueue(
  dataDir: string
): Promise<PostWatchQueue> {
  const file = postWatchQueuePath(dataDir);
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<PostWatchQueue>;
    const watches = Array.isArray(parsed.watches)
      ? parsed.watches.filter(isWatchEntry)
      : [];
    return {
      watches,
      updatedAt:
        typeof parsed.updatedAt === "string"
          ? parsed.updatedAt
          : new Date(0).toISOString(),
    };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { watches: [], updatedAt: new Date(0).toISOString() };
    }
    throw err;
  }
}

export async function writePostWatchQueue(
  dataDir: string,
  queue: PostWatchQueue
): Promise<void> {
  const file = postWatchQueuePath(dataDir);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify(
      { ...queue, updatedAt: new Date().toISOString() },
      null,
      2
    )}\n`,
    "utf8"
  );
}

/**
 * Enroll a live-posted comment for later reply/removal polling.
 */
export async function enrollPostWatch(
  dataDir: string,
  input: {
    postedUrl: string;
    subreddit: string;
    threadUrl: string;
    threadTitle: string;
    draftId?: string;
    jobId?: string;
    minAgeHours: number;
    maxAgeHours: number;
    nowMs?: number;
  }
): Promise<PostWatchEntry> {
  const nowMs = input.nowMs ?? Date.now();
  const minH = Math.max(0, input.minAgeHours);
  const maxH = Math.max(minH, input.maxAgeHours);
  const id = `watch-${hashId(input.postedUrl)}-${nowMs.toString(36)}`;
  const entry: PostWatchEntry = {
    id,
    enrolledAt: new Date(nowMs).toISOString(),
    checkAfter: new Date(nowMs + minH * MS_PER_HOUR).toISOString(),
    expiresAt: new Date(nowMs + maxH * MS_PER_HOUR).toISOString(),
    subreddit: input.subreddit,
    threadUrl: input.threadUrl,
    threadTitle: input.threadTitle,
    postedUrl: input.postedUrl,
    commentId: commentIdFromPermalink(input.postedUrl),
    draftId: input.draftId,
    jobId: input.jobId,
    status: "pending",
  };

  const queue = await readPostWatchQueue(dataDir);
  // Dedupe by postedUrl among pending watches.
  queue.watches = queue.watches.filter(
    (w) => !(w.status === "pending" && w.postedUrl === input.postedUrl)
  );
  queue.watches.push(entry);
  await writePostWatchQueue(dataDir, queue);
  return entry;
}

/**
 * Process due watches: visibility + replies → follow-up draft skeletons.
 */
export async function processDuePostWatches(
  cfg: CommunityRuntimeConfig = getCommunityConfig(),
  opts?: {
    nowMs?: number;
    fetchComment?: typeof fetchRedditComment;
    maxPerRun?: number;
  }
): Promise<PostWatchProcessResult> {
  const nowMs = opts?.nowMs ?? Date.now();
  const maxPerRun = opts?.maxPerRun ?? cfg.postWatch.maxPerRun;
  const fetchFn = opts?.fetchComment ?? fetchRedditComment;
  const dataDir = cfg.reddit.dataDir;

  if (!cfg.postWatch.enabled) {
    return {
      checked: 0,
      replied: 0,
      removed: 0,
      expired: 0,
      errors: 0,
      followUps: [],
    };
  }

  const queue = await readPostWatchQueue(dataDir);
  const due = queue.watches
    .filter((w) => w.status === "pending" && Date.parse(w.checkAfter) <= nowMs)
    .slice(0, Math.max(0, maxPerRun));

  const result: PostWatchProcessResult = {
    checked: 0,
    replied: 0,
    removed: 0,
    expired: 0,
    errors: 0,
    followUps: [],
  };

  for (const watch of due) {
    result.checked += 1;
    watch.lastCheckedAt = new Date(nowMs).toISOString();
    const expired = Date.parse(watch.expiresAt) <= nowMs;

    const fetched = await fetchFn(watch.postedUrl, {
      userAgent: cfg.reddit.userAgent,
    });

    if (!fetched.ok || !fetched.comment) {
      if (fetched.status === 404 || /not found/i.test(fetched.error ?? "")) {
        watch.status = "removed";
        watch.lastError = fetched.error;
        result.removed += 1;
        continue;
      }
      watch.lastError = fetched.error ?? "fetch failed";
      if (expired) {
        watch.status = "expired";
        result.expired += 1;
      } else {
        result.errors += 1;
      }
      continue;
    }

    const comment = fetched.comment;
    if (comment.removed || comment.deleted) {
      watch.status = "removed";
      result.removed += 1;
      continue;
    }

    const replies = comment.replies;
    watch.replyCount = replies.length;

    if (replies.length > 0) {
      watch.status = "replied";
      const followUp = buildFollowUpDraft(watch, comment.body, replies, {
        intensity: cfg.postWatch.followUpIntensity,
      });
      watch.followUpDraftId = followUp.id;
      result.followUps.push(followUp);
      result.replied += 1;
      continue;
    }

    if (expired) {
      watch.status = "expired";
      result.expired += 1;
    }
    // else stay pending for a later run
  }

  await writePostWatchQueue(dataDir, queue);
  return result;
}

export function buildFollowUpDraft(
  watch: PostWatchEntry,
  ourBody: string,
  replies: Array<{ author: string; body: string; id: string }>,
  opts?: { intensity?: PromoIntensity; nowMs?: number }
): CommunityDraft {
  const now = new Date(opts?.nowMs ?? Date.now()).toISOString();
  const replyBlock = replies
    .slice(0, 5)
    .map((r) => `@${r.author}: ${r.body.slice(0, 500)}`)
    .join("\n\n");
  const opText =
    `Our earlier comment:\n${ourBody.slice(0, 1500)}\n\n` +
    `Replies to address:\n${replyBlock}`;

  return {
    id: `followup-${watch.id}`,
    platform: "reddit",
    subreddit: watch.subreddit,
    threadUrl: watch.threadUrl,
    threadTitle: watch.threadTitle.startsWith("Re:")
      ? watch.threadTitle
      : `Re: ${watch.threadTitle}`,
    opText: opText.slice(0, 4000),
    draftText: "",
    intensity: opts?.intensity ?? 0,
    score: {
      problemFit: true,
      wantsHelp: true,
      rulesOk: true,
      freshnessOk: true,
      valueWithoutApp: true,
      competition: true,
      icpFit: true,
      plugNaturalness: true,
    },

    rationale: `post-watch follow-up: ${replies.length} reply(ies) on ${watch.postedUrl}`,
    status: "proposed",
    createdAt: now,
    // App id; execute rewrites utm_content to the follow-up jobId.
    utmCampaign: "community-engager",
  };
}

export function formatPostWatchLog(result: PostWatchProcessResult): string {
  return (
    `[post-watch] checked=${result.checked} replied=${result.replied} ` +
    `removed=${result.removed} expired=${result.expired} errors=${result.errors} ` +
    `followUps=${result.followUps.length}`
  );
}

function isWatchEntry(raw: unknown): raw is PostWatchEntry {
  if (!raw || typeof raw !== "object") return false;
  const w = raw as Record<string, unknown>;
  return (
    typeof w.id === "string" &&
    typeof w.postedUrl === "string" &&
    typeof w.status === "string" &&
    typeof w.checkAfter === "string"
  );
}

function hashId(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}
