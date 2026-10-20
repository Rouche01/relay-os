import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getCommunityConfig,
  type CommunityRuntimeConfig,
} from "../../reddit/config.js";
import {
  commentIdFromPermalink,
  fetchRedditComment,
} from "../../reddit/write/comment-fetch.js";
import type { OutcomeTagHint } from "../learn/outcome-tags.js";
import { detectDmInterest } from "../learn/outcome-tags.js";
import type { CommunityDraft, PromoIntensity } from "../../types.js";

export type PostWatchStatus =
  | "pending"
  | "replied"
  | "removed"
  | "expired"
  | "error";

/** first_look = never checked before; sustained = later polls until maxAge. */
export type PostWatchPhase = "first_look" | "sustained";

export interface PostWatchEntry {
  id: string;
  enrolledAt: string;
  /** First eligible check time (enrolledAt + firstCheckAfterHours). */
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

/** Per-candidate row inside a sweep log (what we polled + outcome). */
export type PostWatchSweepOutcome =
  | "replied"
  | "removed"
  | "expired"
  | "pending"
  | "error"
  | "skipped";

export interface PostWatchSweepCandidate {
  watchId: string;
  draftId?: string;
  jobId?: string;
  subreddit: string;
  postedUrl: string;
  /** first_look vs later sustained polls. */
  phase: PostWatchPhase;
  /** Fetch / classification outcome for this candidate. */
  outcome: PostWatchSweepOutcome;
  /** True when the public JSON fetch returned ok + a comment body. */
  fetchOk: boolean;
  httpStatus?: number;
  replyCount?: number;
  error?: string;
}

/** One post-watch (or future posted-window) sweep — durable under post-watch/sweeps/. */
export interface PostWatchSweepLog {
  schemaVersion: 1;
  sweepId: string;
  startedAt: string;
  endedAt: string;
  source: "queue" | "posted_window";
  /** Due candidates considered this run (before per-item results). */
  candidateCount: number;
  checked: number;
  replied: number;
  removed: number;
  expired: number;
  errors: number;
  pending: number;
  /** True when every fetched candidate had fetchOk (or none checked). */
  success: boolean;
  candidates: PostWatchSweepCandidate[];
}

export interface PostWatchProcessResult {
  checked: number;
  replied: number;
  removed: number;
  expired: number;
  errors: number;
  followUps: CommunityDraft[];
  /** VoltMem outcome tags to write after the poll (got_reply / removed / dm_interest). */
  outcomeHints: OutcomeTagHint[];
  /** Durable sweep log (when persist enabled). */
  sweep?: PostWatchSweepLog;
  /** Absolute path of the written sweep JSON, if persisted. */
  sweepPath?: string;
}

const MS_PER_HOUR = 60 * 60 * 1000;

export function postWatchQueuePath(dataDir: string): string {
  return path.join(dataDir, "post-watch", "queue.json");
}

export function postWatchSweepsDir(dataDir: string): string {
  return path.join(dataDir, "post-watch", "sweeps");
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
 * Enroll a live-posted comment for two-phase polling:
 * first look after {@link firstCheckAfterHours}, then sustained until maxAge.
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
    /** Hours until first look (preferred). */
    firstCheckAfterHours?: number;
    /** @deprecated Alias for firstCheckAfterHours. */
    minAgeHours?: number;
    maxAgeHours: number;
    nowMs?: number;
  }
): Promise<PostWatchEntry> {
  const nowMs = input.nowMs ?? Date.now();
  const firstH = Math.max(
    0,
    input.firstCheckAfterHours ?? input.minAgeHours ?? 1
  );
  const maxH = Math.max(firstH, input.maxAgeHours);
  const id = `watch-${hashId(input.postedUrl)}-${nowMs.toString(36)}`;
  const entry: PostWatchEntry = {
    id,
    enrolledAt: new Date(nowMs).toISOString(),
    checkAfter: new Date(nowMs + firstH * MS_PER_HOUR).toISOString(),
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

/** Prefer never-checked (first_look) so early follow-ups aren't starved. */
export function prioritizeDueWatches(
  due: PostWatchEntry[],
  maxPerRun: number
): PostWatchEntry[] {
  const sorted = [...due].sort((a, b) => {
    const aFirst = a.lastCheckedAt ? 1 : 0;
    const bFirst = b.lastCheckedAt ? 1 : 0;
    if (aFirst !== bFirst) return aFirst - bFirst;
    return Date.parse(a.checkAfter) - Date.parse(b.checkAfter);
  });
  return sorted.slice(0, Math.max(0, maxPerRun));
}

/**
 * Process due watches: visibility + replies → follow-up draft skeletons.
 * Writes a durable sweep log under `{dataDir}/post-watch/sweeps/` (candidates + outcomes).
 */
export async function processDuePostWatches(
  cfg: CommunityRuntimeConfig = getCommunityConfig(),
  opts?: {
    nowMs?: number;
    fetchComment?: typeof fetchRedditComment;
    maxPerRun?: number;
    /** Persist sweep JSON (default true). */
    persistSweep?: boolean;
    /** Sweep source label (default queue). */
    sweepSource?: PostWatchSweepLog["source"];
  }
): Promise<PostWatchProcessResult> {
  const nowMs = opts?.nowMs ?? Date.now();
  const startedAt = new Date(nowMs).toISOString();
  const maxPerRun = opts?.maxPerRun ?? cfg.postWatch.maxPerRun;
  const fetchFn = opts?.fetchComment ?? fetchRedditComment;
  const dataDir = cfg.reddit.dataDir;
  const persistSweep = opts?.persistSweep !== false;
  const sweepSource = opts?.sweepSource ?? "queue";

  if (!cfg.postWatch.enabled) {
    return {
      checked: 0,
      replied: 0,
      removed: 0,
      expired: 0,
      errors: 0,
      followUps: [],
      outcomeHints: [],
    };
  }

  const queue = await readPostWatchQueue(dataDir);
  const dueAll = queue.watches.filter(
    (w) => w.status === "pending" && Date.parse(w.checkAfter) <= nowMs
  );
  const due = prioritizeDueWatches(dueAll, maxPerRun);

  const result: PostWatchProcessResult = {
    checked: 0,
    replied: 0,
    removed: 0,
    expired: 0,
    errors: 0,
    followUps: [],
    outcomeHints: [],
  };
  const candidates: PostWatchSweepCandidate[] = [];
  let pendingLeft = 0;

  for (const watch of due) {
    result.checked += 1;
    const phase: PostWatchPhase = watch.lastCheckedAt
      ? "sustained"
      : "first_look";
    watch.lastCheckedAt = new Date(nowMs).toISOString();
    const expired = Date.parse(watch.expiresAt) <= nowMs;
    const baseCand = {
      watchId: watch.id,
      draftId: watch.draftId,
      jobId: watch.jobId,
      subreddit: watch.subreddit,
      postedUrl: watch.postedUrl,
      phase,
    };

    const fetched = await fetchFn(watch.postedUrl, {
      userAgent: cfg.reddit.userAgent,
    });

    if (!fetched.ok || !fetched.comment) {
      if (fetched.status === 404 || /not found/i.test(fetched.error ?? "")) {
        watch.status = "removed";
        watch.lastError = fetched.error;
        result.removed += 1;
        result.outcomeHints.push(removedHint(watch, fetched.error));
        candidates.push({
          ...baseCand,
          outcome: "removed",
          fetchOk: false,
          httpStatus: fetched.status,
          error: fetched.error,
        });
        continue;
      }
      watch.lastError = fetched.error ?? "fetch failed";
      if (expired) {
        watch.status = "expired";
        result.expired += 1;
        candidates.push({
          ...baseCand,
          outcome: "expired",
          fetchOk: false,
          httpStatus: fetched.status,
          error: watch.lastError,
        });
      } else {
        result.errors += 1;
        candidates.push({
          ...baseCand,
          outcome: "error",
          fetchOk: false,
          httpStatus: fetched.status,
          error: watch.lastError,
        });
      }
      continue;
    }

    const comment = fetched.comment;
    if (comment.removed || comment.deleted) {
      watch.status = "removed";
      result.removed += 1;
      result.outcomeHints.push(
        removedHint(watch, comment.deleted ? "deleted" : "removed")
      );
      candidates.push({
        ...baseCand,
        outcome: "removed",
        fetchOk: true,
        httpStatus: fetched.status,
        error: comment.deleted ? "deleted" : "removed",
      });
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
      result.outcomeHints.push({
        tag: "got_reply",
        meta: {
          draftId: watch.draftId,
          jobId: watch.jobId,
          subreddit: watch.subreddit,
          threadUrl: watch.threadUrl,
          threadTitle: watch.threadTitle,
          note: `replies=${replies.length}; phase=${phase}`,
        },
      });
      if (detectDmInterest(replies)) {
        result.outcomeHints.push({
          tag: "dm_interest",
          meta: {
            draftId: watch.draftId,
            jobId: watch.jobId,
            subreddit: watch.subreddit,
            threadUrl: watch.threadUrl,
            threadTitle: watch.threadTitle,
            note: "reply text suggests DM/private follow-up",
          },
        });
      }
      candidates.push({
        ...baseCand,
        outcome: "replied",
        fetchOk: true,
        httpStatus: fetched.status,
        replyCount: replies.length,
      });
      continue;
    }

    if (expired) {
      watch.status = "expired";
      result.expired += 1;
      candidates.push({
        ...baseCand,
        outcome: "expired",
        fetchOk: true,
        httpStatus: fetched.status,
        replyCount: 0,
      });
    } else {
      pendingLeft += 1;
      candidates.push({
        ...baseCand,
        outcome: "pending",
        fetchOk: true,
        httpStatus: fetched.status,
        replyCount: 0,
      });
    }
  }

  await writePostWatchQueue(dataDir, queue);

  const endedAt = new Date(opts?.nowMs ?? Date.now()).toISOString();
  const sweepId = `sweep-${nowMs.toString(36)}-${hashId(startedAt + due.length)}`;
  const sweep: PostWatchSweepLog = {
    schemaVersion: 1,
    sweepId,
    startedAt,
    endedAt,
    source: sweepSource,
    candidateCount: due.length,
    checked: result.checked,
    replied: result.replied,
    removed: result.removed,
    expired: result.expired,
    errors: result.errors,
    pending: pendingLeft,
    success: result.errors === 0,
    candidates,
  };
  result.sweep = sweep;

  if (persistSweep) {
    try {
      result.sweepPath = await persistPostWatchSweep(dataDir, sweep);
    } catch (err) {
      console.warn(
        "[post-watch] sweep log persist failed:",
        err instanceof Error ? err.message : err
      );
    }
  }

  return result;
}

/** Write one sweep JSON; returns absolute path. */
export async function persistPostWatchSweep(
  dataDir: string,
  sweep: PostWatchSweepLog
): Promise<string> {
  const dir = postWatchSweepsDir(dataDir);
  await mkdir(dir, { recursive: true });
  const stamp = sweep.startedAt.replace(/[:.]/g, "-");
  const file = path.join(dir, `${stamp}-${sweep.sweepId}.json`);
  await writeFile(file, JSON.stringify(sweep, null, 2), "utf8");
  return file;
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
  const sweepBit = result.sweep
    ? ` sweep=${result.sweep.sweepId}` +
      (result.sweep.success ? " ok" : " FAIL") +
      (result.sweepPath ? ` log=${result.sweepPath}` : "")
    : "";
  return (
    `[post-watch] checked=${result.checked} replied=${result.replied} ` +
    `removed=${result.removed} expired=${result.expired} errors=${result.errors} ` +
    `followUps=${result.followUps.length}` +
    sweepBit
  );
}

function removedHint(
  watch: PostWatchEntry,
  note?: string
): OutcomeTagHint {
  return {
    tag: "removed",
    meta: {
      draftId: watch.draftId,
      jobId: watch.jobId,
      subreddit: watch.subreddit,
      threadUrl: watch.threadUrl,
      threadTitle: watch.threadTitle,
      note,
    },
  };
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
