import path from "node:path";
import {
  ComputerEngine,
  ComputerTaskRunner,
  type ComputerTaskResult,
} from "@relay/engines-computer";
import type { CommunityDraft } from "../../types.js";
import type { CommunityRuntimeConfig } from "../config.js";
import { createComputerEngine } from "./computer-dry-run.js";
import type { ComputerRunSession } from "./computer-run-session.js";

export interface ComputerPreviewOptions {
  opportunities: CommunityDraft[];
  cfg: CommunityRuntimeConfig;
  /** Bound app engine; defaults to a fresh engine from cfg.computer. */
  engine?: ComputerEngine;
  /**
   * Run-scoped desktop. When set, leases via engage job_id, parks after tour
   * (soft), and leaves Firefox warm for HITL / execute reattach.
   */
  runSession?: ComputerRunSession;
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
 * With `runSession`: park soft after tour (same desktop for HITL/execute).
 * Without: one-shot lease then soft park via runner release.
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
  const runSession = opts.runSession;
  const jobId =
    runSession?.jobId ?? opts.jobId ?? `preview-${Date.now()}`;

  const engine =
    runSession?.engine ??
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

  let vncUrl: string | undefined;

  if (runSession) {
    const lease = await runSession.ensureLeased();
    if (!lease.ok) {
      return {
        success: false,
        error: lease.error ?? "computer lease failed",
        urls,
      };
    }
    vncUrl = lease.vncUrl ?? runSession.vncUrl;
  } else {
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
    vncUrl =
      (lease.data?.vnc_url as string | undefined) ??
      engine.getVncUrl() ??
      undefined;
  }

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

  try {
    const result = await runner.run(
      "tour_urls",
      {
        urls,
        settleMs: cfg.computer.settleMs,
        paceMs: 500,
        fileStemPrefix: "preview",
        evidenceDir,
      },
      {
        jobId,
        evidenceDir,
        reuseSession: true,
        // Run session parks itself so soft park state stays on ComputerRunSession.
        holdSession: Boolean(runSession),
      }
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
      vncUrl: result.vncUrl ?? vncUrl ?? runSession?.vncUrl,
      urls,
    };
  } finally {
    if (runSession) {
      const parked = await runSession.park();
      if (!parked.ok) {
        console.warn(
          `[computer:preview] park failed: ${parked.error ?? "unknown"}`
        );
      }
    }
  }
}
