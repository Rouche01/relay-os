import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isExecutableStatus } from "@relay/action-store";
import type { CommunityDraft } from "./types.js";
import { RedditClient } from "./reddit/client.js";
import {
  getRedditEnv,
  resolveWriteTransport,
  resolveWriteTransportChain,
  type RedditEnvConfig,
} from "./reddit/config.js";
import { hasStorageState } from "./reddit/cookies.js";
import { postCommentBrowser } from "./reddit/browser-comment.js";
import { executeJobId } from "./reddit/scout-live.js";

export interface ExecuteResult {
  ok: boolean;
  dryRun: boolean;
  jobId: string;
  /** browser | oauth | dry-run | none */
  transport?: string;
  postedUrl?: string;
  idempotentHit?: boolean;
  error?: string;
  log?: string;
}

export interface ExecuteOptions {
  /** Override dry-run (default from REDDIT_DRY_RUN). */
  dryRun?: boolean;
  dataDir?: string;
  /** Browser path: attempt login if jar missing (default true when user/pass set). */
  loginIfNeeded?: boolean;
}

/**
 * Posts only after human approval/edit.
 * Default: dry-run. Set REDDIT_DRY_RUN=false to submit for real.
 * Idempotent via job id under `{dataDir}/jobs/`.
 *
 * Transport (`REDDIT_TRANSPORT` / auto):
 * - browser preferred (HITL cookie path)
 * - oauth optional fast path when REDDIT_CLIENT_* present (auto falls back after browser failure)
 */
export async function executeApproved(
  draft: CommunityDraft,
  opts: ExecuteOptions = {}
): Promise<ExecuteResult> {
  const cfg = getRedditEnv();
  const dryRun = opts.dryRun ?? cfg.dryRun;
  const jobId = executeJobId(draft);
  const dataDir = opts.dataDir ?? cfg.dataDir;
  const jobPath = path.join(dataDir, "jobs", `${jobId.replace(/:/g, "_")}.json`);
  const writeTransport = resolveWriteTransport(cfg);
  const chain = resolveWriteTransportChain(cfg);

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

  const text = applyUtmLinks(
    draft.draftText,
    cfg.lpBaseUrl,
    draft.utmCampaign ?? "community"
  );

  const prior = await readJob(jobPath);
  if (prior?.ok) {
    console.log(`[execute] idempotent hit jobId=${jobId}`);
    return { ...prior, jobId, idempotentHit: true };
  }

  if (dryRun) {
    const jarPresent = await hasStorageState(cfg);
    const log =
      `[dry-run] Would post to r/${draft.subreddit}\n` +
      `  transport: ${writeTransport} (REDDIT_TRANSPORT=${cfg.transport})\n` +
      `  chain: ${chain.join(" → ") || "(none)"}\n` +
      `  oauthConfigured: ${cfg.oauthConfigured} hasUserPass: ${cfg.hasUserPass}\n` +
      `  cookieDir: ${cfg.cookieDir}\n` +
      `  storageState: ${jarPresent ? "present" : "missing"}\n` +
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
      transport: "dry-run",
      log,
      postedUrl: undefined,
    };
    await writeJob(jobPath, result);
    return result;
  }

  if (chain.length === 0) {
    return {
      ok: false,
      dryRun: false,
      jobId,
      error: "no write transport available — configure browser user/pass or OAuth",
    };
  }

  const errors: string[] = [];
  for (const step of chain) {
    if (step === "browser") {
      const browserResult = await tryBrowserPost(draft, text, cfg, opts, jobId);
      if (browserResult.ok) {
        await writeJob(jobPath, browserResult);
        return browserResult;
      }
      errors.push(`browser: ${browserResult.error}`);
      if (chain.includes("oauth")) {
        console.warn(
          `[execute] browser failed (${browserResult.error}); trying oauth fallback…`
        );
      }
      continue;
    }

    if (step === "oauth") {
      const oauthResult = await tryOauthPost(draft, text, cfg, jobId);
      if (oauthResult.ok) {
        await writeJob(jobPath, oauthResult);
        return oauthResult;
      }
      errors.push(`oauth: ${oauthResult.error}`);
    }
  }

  return {
    ok: false,
    dryRun: false,
    jobId,
    error: errors.join(" | ") || "all write transports failed",
  };
}

async function tryBrowserPost(
  draft: CommunityDraft,
  text: string,
  cfg: RedditEnvConfig,
  opts: ExecuteOptions,
  jobId: string
): Promise<ExecuteResult> {
  try {
    const posted = await postCommentBrowser({
      threadUrl: draft.threadUrl,
      text,
      cfg,
      loginIfNeeded: opts.loginIfNeeded,
    });
    if (!posted.ok) {
      return {
        ok: false,
        dryRun: false,
        jobId,
        error: posted.error ?? "browser comment failed",
      };
    }
    const result: ExecuteResult = {
      ok: true,
      dryRun: false,
      jobId,
      transport: "browser",
      postedUrl: posted.permalink,
      log: `[posted:browser] ${posted.permalink ?? draft.threadUrl}`,
    };
    console.log(result.log);
    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, dryRun: false, jobId, error };
  }
}

async function tryOauthPost(
  draft: CommunityDraft,
  text: string,
  cfg: RedditEnvConfig,
  jobId: string
): Promise<ExecuteResult> {
  if (!cfg.oauthConfigured) {
    return {
      ok: false,
      dryRun: false,
      jobId,
      error: "OAuth credentials missing",
    };
  }
  if (!draft.redditThingId) {
    return {
      ok: false,
      dryRun: false,
      jobId,
      error: "missing redditThingId — cannot post via OAuth",
    };
  }
  try {
    const client = new RedditClient({ ...cfg, dryRun: false });
    const posted = await client.postComment(draft.redditThingId, text);
    const result: ExecuteResult = {
      ok: true,
      dryRun: false,
      jobId,
      transport: "oauth",
      postedUrl: posted.permalink,
      log: `[posted:oauth] ${posted.permalink ?? posted.id}`,
    };
    console.log(result.log);
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
