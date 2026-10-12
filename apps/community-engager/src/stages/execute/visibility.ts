/**
 * Immediate post-execute visibility check (logged-out public JSON).
 * Detects quick removal / missing comments (shadowban-adjacent) before post-watch.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  fetchRedditComment,
  type FetchCommentResult,
} from "../../reddit/write/comment-fetch.js";
import {
  getCommunityConfig,
  type CommunityRuntimeConfig,
} from "../../reddit/config.js";

export type VisibilityStatus =
  | "visible"
  | "removed"
  | "missing"
  | "error"
  | "skipped";

export interface VisibilityCheckResult {
  status: VisibilityStatus;
  /** True only when the comment is publicly readable and not removed/deleted. */
  visibilityOk: boolean;
  permalink: string;
  checkedAt: string;
  author?: string;
  httpStatus?: number;
  error?: string;
  /** Expected author mismatch (possible spoof / wrong permalink). */
  authorMismatch?: boolean;
  jobId?: string;
}

export function formatVisibilityLog(result: VisibilityCheckResult): string {
  if (result.status === "skipped") {
    return `[visibility] skipped${result.error ? ` · ${result.error}` : ""}`;
  }
  const flag =
    result.status === "visible"
      ? "OK"
      : result.status === "error"
        ? "ERROR"
        : "FAIL";
  return (
    `[visibility] ${flag} status=${result.status}` +
    (result.author ? ` author=${result.author}` : "") +
    (result.authorMismatch ? " authorMismatch=1" : "") +
    (result.error ? ` · ${result.error}` : "")
  );
}

/**
 * Classify a public comment fetch into a visibility outcome.
 */
export function classifyVisibilityFetch(
  fetched: FetchCommentResult,
  opts?: { expectedAuthor?: string }
): Pick<
  VisibilityCheckResult,
  "status" | "visibilityOk" | "author" | "httpStatus" | "error" | "authorMismatch"
> {
  if (!fetched.ok || !fetched.comment) {
    if (
      fetched.status === 404 ||
      /not found/i.test(fetched.error ?? "") ||
      /comment not found/i.test(fetched.error ?? "")
    ) {
      return {
        status: "missing",
        visibilityOk: false,
        httpStatus: fetched.status,
        error: fetched.error ?? "not found in public listing",
      };
    }
    return {
      status: "error",
      visibilityOk: false,
      httpStatus: fetched.status,
      error: fetched.error ?? "fetch failed",
    };
  }

  const comment = fetched.comment;
  if (comment.removed || comment.deleted) {
    return {
      status: "removed",
      visibilityOk: false,
      author: comment.author,
      httpStatus: fetched.status,
      error: comment.deleted ? "deleted" : "removed",
    };
  }

  const expected = opts?.expectedAuthor?.trim().replace(/^u\//i, "");
  let authorMismatch = false;
  if (expected && comment.author) {
    authorMismatch =
      comment.author.toLowerCase() !== expected.toLowerCase();
  }

  return {
    status: authorMismatch ? "missing" : "visible",
    visibilityOk: !authorMismatch,
    author: comment.author,
    httpStatus: fetched.status,
    authorMismatch: authorMismatch || undefined,
    error: authorMismatch
      ? `author mismatch (expected ${expected}, got ${comment.author})`
      : undefined,
  };
}

export async function checkCommentVisibility(
  permalink: string,
  opts?: {
    cfg?: CommunityRuntimeConfig;
    jobId?: string;
    /** Override delay before fetch (ms). */
    delayMs?: number;
    fetchComment?: typeof fetchRedditComment;
    /** Skip sleep (tests). */
    nowMs?: number;
    persist?: boolean;
  }
): Promise<VisibilityCheckResult> {
  const cfg = opts?.cfg ?? getCommunityConfig();
  const checkedAt = new Date(opts?.nowMs ?? Date.now()).toISOString();
  const permalinkNorm = permalink.trim();

  if (!cfg.visibility.enabled) {
    return {
      status: "skipped",
      visibilityOk: false,
      permalink: permalinkNorm,
      checkedAt,
      error: "disabled",
      jobId: opts?.jobId,
    };
  }

  if (!permalinkNorm) {
    return {
      status: "skipped",
      visibilityOk: false,
      permalink: "",
      checkedAt,
      error: "empty permalink",
      jobId: opts?.jobId,
    };
  }

  const delayMs = opts?.delayMs ?? cfg.visibility.delayMs;
  if (delayMs > 0) {
    await sleep(delayMs);
  }

  const fetchFn = opts?.fetchComment ?? fetchRedditComment;
  const fetched = await fetchFn(permalinkNorm, {
    userAgent: cfg.reddit.userAgent,
  });

  const classified = classifyVisibilityFetch(fetched, {
    expectedAuthor: cfg.reddit.username,
  });

  const result: VisibilityCheckResult = {
    ...classified,
    permalink: permalinkNorm,
    checkedAt,
    jobId: opts?.jobId,
  };

  if (opts?.persist !== false) {
    try {
      await persistVisibilityResult(cfg.reddit.dataDir, result);
    } catch (err) {
      console.warn(
        "[visibility] persist failed:",
        err instanceof Error ? err.message : err
      );
    }
  }

  return result;
}

async function persistVisibilityResult(
  dataDir: string,
  result: VisibilityCheckResult
): Promise<void> {
  const dir = path.join(dataDir, "visibility");
  await mkdir(dir, { recursive: true });
  const key = (result.jobId ?? "unknown").replace(/:/g, "_");
  const file = path.join(dir, `${key}.json`);
  await writeFile(file, JSON.stringify(result, null, 2), "utf8");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
