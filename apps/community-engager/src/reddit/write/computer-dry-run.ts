import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ComputerEngine } from "@relay/engines-computer";
import type { CommunityDraft } from "../../types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
}

/**
 * Lease a Computer Runtime desktop, open the thread URL via keystrokes,
 * capture a screenshot into evidence, release. Never posts a comment.
 */
export async function runComputerDryRunEvidence(
  opts: ComputerDryRunOptions
): Promise<ComputerDryRunResult> {
  const { draft, text, jobId, dataDir, engine } = opts;
  const settleMs = opts.settleMs ?? 2000;
  const evidenceDir = path.join(dataDir, "evidence", "computer");
  await mkdir(evidenceDir, { recursive: true });
  const safeId = jobId.replace(/:/g, "_");
  const pngPath = path.join(evidenceDir, `${safeId}.png`);
  const metaPath = path.join(evidenceDir, `${safeId}.json`);

  const lease = await engine.execute({
    type: "lease",
    params: { job_id: jobId, agent_id: "community-engager" },
  });
  if (!lease.success) {
    return {
      ok: false,
      dryRun: true,
      jobId,
      transport: "computer",
      error: lease.error ?? "computer lease failed",
    };
  }

  const vncUrl =
    (lease.data?.vnc_url as string | undefined) ?? engine.getVncUrl() ?? undefined;

  try {
    const focus = await engine.execute({
      type: "action",
      params: { action: { type: "key", text: "ctrl+l" } },
    });
    if (!focus.success) {
      return fail(jobId, vncUrl, focus.error ?? "ctrl+l failed");
    }

    const typed = await engine.execute({
      type: "action",
      params: { action: { type: "type", text: draft.threadUrl } },
    });
    if (!typed.success) {
      return fail(jobId, vncUrl, typed.error ?? "type url failed");
    }

    const go = await engine.execute({
      type: "action",
      params: { action: { type: "key", text: "Return" } },
    });
    if (!go.success) {
      return fail(jobId, vncUrl, go.error ?? "Return failed");
    }

    await sleep(settleMs);

    const shot = await engine.execute({ type: "screenshot", params: {} });
    if (!shot.success || typeof shot.data?.image !== "string") {
      return fail(jobId, vncUrl, shot.error ?? "screenshot failed");
    }

    const imageB64 = shot.data.image as string;
    await writeFile(pngPath, Buffer.from(imageB64, "base64"));
    const meta = {
      jobId,
      threadUrl: draft.threadUrl,
      subreddit: draft.subreddit,
      vncUrl,
      pngPath,
      capturedAt: new Date().toISOString(),
      note: "computer dry-run evidence — comment was NOT posted",
      draftPreview: text.slice(0, 280),
    };
    await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");

    const log =
      `[computer:dry-run] Opened thread on leased desktop (no post)\n` +
      `  jobId: ${jobId}\n` +
      `  thread: ${draft.threadUrl}\n` +
      `  vnc: ${vncUrl ?? "(none)"}\n` +
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
    await engine.execute({ type: "release", params: {} });
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
