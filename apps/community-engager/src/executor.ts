import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isExecutableStatus } from "@relay/action-store";
import type { CommunityDraft } from "./types.js";
import { RedditClient } from "./reddit/client.js";
import { getRedditEnv } from "./reddit/config.js";
import { executeJobId } from "./reddit/scout-live.js";

export interface ExecuteResult {
  ok: boolean;
  dryRun: boolean;
  jobId: string;
  postedUrl?: string;
  error?: string;
  log?: string;
}

export interface ExecuteOptions {
  /** Override dry-run (default from REDDIT_DRY_RUN). */
  dryRun?: boolean;
  dataDir?: string;
}

/**
 * Posts only after human approval/edit.
 * Default: dry-run. Set REDDIT_DRY_RUN=false to submit for real.
 * Idempotent via job id under `.data/jobs/`.
 */
export async function executeApproved(
  draft: CommunityDraft,
  opts: ExecuteOptions = {}
): Promise<ExecuteResult> {
  const cfg = getRedditEnv();
  const dryRun = opts.dryRun ?? cfg.dryRun;
  const jobId = executeJobId(draft);
  const dataDir = opts.dataDir ?? path.resolve(process.cwd(), ".data");
  const jobPath = path.join(dataDir, "jobs", `${jobId.replace(/:/g, "_")}.json`);

  if (!isExecutableStatus(draft.status)) {
    return {
      ok: false,
      dryRun,
      jobId,
      error: `refusing to post status=${draft.status}`,
    };
  }

  if (draft.intensity === 2 && !/gostylens/i.test(draft.draftText)) {
    return {
      ok: false,
      dryRun,
      jobId,
      error: "intensity 2 requires GoStylens disclosure in draft text",
    };
  }

  const text = applyUtmLinks(draft.draftText, cfg.lpBaseUrl, draft.utmCampaign ?? "community");

  const prior = await readJob(jobPath);
  if (prior?.ok) {
    console.log(`[execute] idempotent hit jobId=${jobId}`);
    return { ...prior, jobId };
  }

  if (dryRun || !cfg.configured) {
    const log =
      `[dry-run] Would post to r/${draft.subreddit}\n` +
      `  jobId: ${jobId}\n` +
      `  thread: ${draft.threadUrl}\n` +
      `  thing: ${draft.redditThingId ?? "(fixture — no thing id)"}\n` +
      `  intensity: ${draft.intensity}\n` +
      `  text:\n${text}`;
    console.log(log);
    const result: ExecuteResult = {
      ok: true,
      dryRun: true,
      jobId,
      log,
      postedUrl: undefined,
    };
    await writeJob(jobPath, result);
    return result;
  }

  if (!draft.redditThingId) {
    return {
      ok: false,
      dryRun: false,
      jobId,
      error: "missing redditThingId — cannot post (fixture draft?)",
    };
  }

  try {
    const client = new RedditClient({ ...cfg, dryRun: false });
    const posted = await client.postComment(draft.redditThingId, text);
    const result: ExecuteResult = {
      ok: true,
      dryRun: false,
      jobId,
      postedUrl: posted.permalink,
      log: `[posted] ${posted.permalink ?? posted.id}`,
    };
    console.log(result.log);
    await writeJob(jobPath, result);
    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, dryRun: false, jobId, error };
  }
}

/** Append UTM params to gostylens / lp links in the draft. */
export function applyUtmLinks(
  text: string,
  _lpBaseUrl: string,
  campaign: string
): string {
  const utm = `utm_source=reddit&utm_medium=community&utm_campaign=${encodeURIComponent(campaign)}`;

  return text.replace(
    /(https?:\/\/(?:www\.)?gostylens\.app[^\s)]*)/gi,
    (url) => {
      const join = url.includes("?") ? "&" : "?";
      if (url.includes("utm_")) return url;
      return `${url}${join}${utm}`;
    }
  );
}

async function readJob(jobPath: string): Promise<ExecuteResult | null> {
  try {
    const raw = await readFile(jobPath, "utf8");
    return JSON.parse(raw) as ExecuteResult;
  } catch {
    return null;
  }
}

async function writeJob(jobPath: string, result: ExecuteResult): Promise<void> {
  await mkdir(path.dirname(jobPath), { recursive: true });
  await writeFile(jobPath, JSON.stringify(result, null, 2), "utf8");
}
