import path from "node:path";
import {
  ComputerEngine,
  ComputerTaskRunner,
} from "@relay/engines-computer";
import type { CommunityDraft } from "../../types.js";
import type { ComputerRunSession } from "./computer-run-session.js";

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
  /**
   * Run-scoped desktop. When set, reattaches via engage job_id and parks soft
   * after evidence (caller recycles at end of App.run).
   */
  runSession?: ComputerRunSession;
  /** Settle time after navigation before screenshot (ms). */
  settleMs?: number;
  /** Inject runner for tests. */
  runner?: ComputerTaskRunner;
}

/**
 * Open the thread URL on a Computer Runtime desktop and capture evidence.
 * Never posts a comment.
 *
 * With `runSession`: ensureLeased (reattach) → open + capture → soft park.
 * Without: lease → open + capture → soft park (one-shot).
 *
 * Implemented via ComputerTaskRunner builtins (`open_url` + `capture_frame`).
 */
export async function runComputerDryRunEvidence(
  opts: ComputerDryRunOptions
): Promise<ComputerDryRunResult> {
  const { draft, text, jobId, dataDir } = opts;
  const runSession = opts.runSession;
  const engine = runSession?.engine ?? opts.engine;
  const settleMs = opts.settleMs ?? 2000;
  const evidenceDir = path.join(dataDir, "evidence", "computer");
  const safeId = jobId.replace(/:/g, "_");
  const pngPath = path.join(evidenceDir, `${safeId}.png`);
  const metaPath = path.join(evidenceDir, `${safeId}.json`);
  const leaseJobId = runSession?.jobId ?? jobId;

  const runner =
    opts.runner ??
    new ComputerTaskRunner({
      engine,
      evidenceDir,
      agentId: "community-engager",
    });

  if (runSession) {
    const lease = await runSession.ensureLeased();
    if (!lease.ok) {
      return fail(jobId, lease.vncUrl, lease.error ?? "computer lease failed");
    }
  }

  try {
    const opened = await runner.run(
      "open_url",
      { url: draft.threadUrl, settleMs },
      {
        jobId: leaseJobId,
        evidenceDir,
        holdSession: true,
        reuseSession: Boolean(runSession) || Boolean(engine.getSessionId()),
      }
    );
    if (!opened.success) {
      if (!runSession) await releaseBestEffort(engine);
      return fail(jobId, opened.vncUrl, opened.error ?? "open_url failed");
    }

    const vncUrl = opened.vncUrl ?? engine.getVncUrl() ?? runSession?.vncUrl;

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
      {
        jobId: leaseJobId,
        evidenceDir,
        reuseSession: true,
        // Run session parks itself; one-shot path soft-parks via runner release.
        holdSession: Boolean(runSession),
      }
    );

    if (!captured.success) {
      if (!runSession) await releaseBestEffort(engine);
      return fail(
        jobId,
        captured.vncUrl ?? vncUrl,
        captured.error ?? "capture_frame failed"
      );
    }

    const log =
      `[computer:dry-run] Opened thread on leased desktop (no post)\n` +
      `  jobId: ${jobId}\n` +
      `  engageJobId: ${leaseJobId}\n` +
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
  } finally {
    if (runSession) {
      const parked = await runSession.park();
      if (!parked.ok) {
        console.warn(
          `[computer:dry-run] park failed: ${parked.error ?? "unknown"}`
        );
      }
    }
  }
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
