import path from "node:path";
import {
  ComputerEngine,
  ComputerTaskRunner,
  type ComputerTaskResult,
} from "@relay/engines-computer";
import type { CommunityDraft } from "../../types.js";
import type { CommunityRuntimeConfig } from "../config.js";
import { createComputerEngine } from "./computer-dry-run.js";

export interface ComputerPreviewOptions {
  opportunities: CommunityDraft[];
  cfg: CommunityRuntimeConfig;
  /** Bound app engine; defaults to a fresh engine from cfg.computer. */
  engine?: ComputerEngine;
  /** Inject runner for tests. */
  runner?: ComputerTaskRunner;
  /** Override evidence root (default `{dataDir}/evidence/computer/preview`). */
  evidenceDir?: string;
  jobId?: string;
}

export interface ComputerPreviewResult extends ComputerTaskResult {
  skipped?: boolean;
  reason?: string;
  urls?: string[];
}

/**
 * Lease desktop → open up to previewMax opportunity thread URLs → screenshot.
 * Prints the VNC URL as soon as the lease succeeds so you can click it while
 * the tour runs. Failures are returned (caller should warn, not abort engage).
 */
export async function runComputerDesktopPreview(
  opts: ComputerPreviewOptions
): Promise<ComputerPreviewResult> {
  const { cfg, opportunities } = opts;
  if (!cfg.computer.preview) {
    return {
      success: true,
      skipped: true,
      reason: "COMPUTER_PREVIEW off",
    };
  }

  const withUrl = opportunities.filter((d) => Boolean(d.threadUrl?.trim()));
  if (withUrl.length === 0) {
    return {
      success: true,
      skipped: true,
      reason: "no opportunity thread URLs",
    };
  }

  const max = Math.max(1, cfg.computer.previewMax);
  const selected = withUrl.slice(0, max);
  const urls = selected.map((d) => d.threadUrl.trim());
  const evidenceDir =
    opts.evidenceDir ??
    path.join(cfg.reddit.dataDir, "evidence", "computer", "preview");
  const jobId = opts.jobId ?? `preview-${Date.now()}`;

  const engine =
    opts.engine ??
    createComputerEngine({
      gatewayUrl: cfg.computer.gatewayUrl,
      apiToken: cfg.computer.apiToken,
    });
  const runner =
    opts.runner ??
    new ComputerTaskRunner({
      engine,
      evidenceDir,
      agentId: "community-engager",
    });

  // Lease first so we can print a clickable VNC URL before navigation starts.
  const lease = await engine.execute({
    type: "lease",
    params: { job_id: jobId, agent_id: "community-engager" },
  });
  if (!lease.success) {
    return {
      success: false,
      error: lease.error ?? "computer lease failed",
      urls,
    };
  }

  const vncUrl =
    (lease.data?.vnc_url as string | undefined) ??
    engine.getVncUrl() ??
    undefined;
  if (vncUrl) {
    // Bare URL on its own line → clickable in most terminals / Cursor.
    console.log("[computer:preview] Live desktop — open while the tour runs:");
    console.log(vncUrl);
  } else {
    console.warn(
      "[computer:preview] lease ok but no vnc_url from gateway — check screenshots under " +
        evidenceDir
    );
  }

  const result = await runner.run(
    "tour_urls",
    {
      urls,
      settleMs: cfg.computer.settleMs,
      paceMs: 500,
      fileStemPrefix: "preview",
      evidenceDir,
    },
    { jobId, evidenceDir, reuseSession: true }
  );

  if (result.evidencePaths?.length) {
    console.log(
      `[computer:preview] screenshots:\n  ${result.evidencePaths
        .filter((p) => p.endsWith(".png"))
        .join("\n  ")}`
    );
  }

  return {
    ...result,
    vncUrl: result.vncUrl ?? vncUrl,
    urls,
  };
}
