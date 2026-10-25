import path from "node:path";
import {
  ComputerEngine,
  ComputerTaskRunner,
} from "@relay/engines-computer";
import type { CommunityDraft } from "../../types.js";

/** Subset of execute result — avoid circular import with executor. */
export interface ComputerDryRunResult {
  ok: boolean;
  dryRun: true;
  jobId: string;
  transport: "computer";
  postedUrl?: undefined;
  error?: string;
  log?: string;
}

export interface ComputerDryRunOptions {
  draft: CommunityDraft;
  /** Draft text after UTM rewrite (logged only — never typed into Reddit). */
  text: string;
  jobId: string;
  dataDir: string;
  engine: ComputerEngine;
  /** Settle time after navigation before screenshot (ms). */
  settleMs?: number;
  /** Inject runner for tests. */
  runner?: ComputerTaskRunner;
}

/**
 * Lease a Computer Runtime desktop, open the thread URL via keystrokes,
 * capture a screenshot into evidence, release. Never posts a comment.
 *
 * Implemented via ComputerTaskRunner builtins (`open_url` + `capture_frame`).
 */
export async function runComputerDryRunEvidence(
  opts: ComputerDryRunOptions
): Promise<ComputerDryRunResult> {
  const { draft, text, jobId, dataDir, engine } = opts;
  const settleMs = opts.settleMs ?? 2000;
  const evidenceDir = path.join(dataDir, "evidence", "computer");
  const safeId = jobId.replace(/:/g, "_");
  const pngPath = path.join(evidenceDir, `${safeId}.png`);
  const metaPath = path.join(evidenceDir, `${safeId}.json`);

  const runner =
    opts.runner ??
    new ComputerTaskRunner({
      engine,
      evidenceDir,
      agentId: "community-engager",
    });

  const opened = await runner.run(
    "open_url",
    { url: draft.threadUrl, settleMs },
    { jobId, evidenceDir, holdSession: true }
  );
  if (!opened.success) {
    await releaseBestEffort(engine);
    return fail(jobId, opened.vncUrl, opened.error ?? "open_url failed");
  }

  const vncUrl = opened.vncUrl ?? engine.getVncUrl() ?? undefined;

  const captured = await runner.run(
    "capture_frame",
    {
      evidenceDir,
      fileStem: safeId,
      meta: {
        jobId,
        threadUrl: draft.threadUrl,
        subreddit: draft.subreddit,
        note: "computer dry-run evidence — comment was NOT posted",
        draftPreview: text.slice(0, 280),
      },
    },
    { jobId, evidenceDir, reuseSession: true }
  );

  if (!captured.success) {
    // capture_frame with reuseSession releases on finish; belt-and-suspenders.
    await releaseBestEffort(engine);
    return fail(
      jobId,
      captured.vncUrl ?? vncUrl,
      captured.error ?? "capture_frame failed"
    );
  }

  const log =
    `[computer:dry-run] Opened thread on leased desktop (no post)\n` +
    `  jobId: ${jobId}\n` +
    `  thread: ${draft.threadUrl}\n` +
    `  vnc: ${captured.vncUrl ?? vncUrl ?? "(none)"}\n` +
    `  evidence: ${pngPath}\n` +
    `  meta: ${metaPath}\n` +
    `  intensity: ${draft.intensity}\n` +
    `  text (not typed):\n${text}`;
  console.log(log);

  return {
    ok: true,
    dryRun: true,
    jobId,
    transport: "computer",
    log,
    postedUrl: undefined,
  };
}

function fail(
  jobId: string,
  vncUrl: string | undefined,
  error: string
): ComputerDryRunResult {
  return {
    ok: false,
    dryRun: true,
    jobId,
    transport: "computer",
    error: vncUrl ? `${error} (vnc=${vncUrl})` : error,
  };
}

async function releaseBestEffort(engine: ComputerEngine): Promise<void> {
  if (!engine.getSessionId()) return;
  try {
    await engine.execute({ type: "release", params: {} });
  } catch {
    /* best-effort */
  }
}

export function createComputerEngine(opts: {
  gatewayUrl?: string;
  apiToken?: string;
}): ComputerEngine {
  return new ComputerEngine({
    baseUrl: opts.gatewayUrl?.trim() || "http://127.0.0.1:9000",
    token: opts.apiToken?.trim() || undefined,
    agentId: "community-engager",
  });
}

export function createComputerEngineFromEnv(
  env: NodeJS.ProcessEnv = process.env
): ComputerEngine {
  return createComputerEngine({
    gatewayUrl: env.COMPUTER_GATEWAY_URL,
    apiToken: env.COMPUTER_API_TOKEN,
  });
}
