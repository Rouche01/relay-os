import type { AgentState } from "@relay/protocol";
import type { FanoutSummary } from "@relay/runtime";
import type { ExecuteResult } from "./executor.js";
import type { CommunityDraft } from "./types.js";

export type JobOutcome =
  | "approved"
  | "edited"
  | "aborted"
  | "failed"
  | "unknown";

export interface JobResult {
  id: string;
  subreddit: string;
  threadUrl: string;
  threadTitle: string;
  state: AgentState;
  outcome: JobOutcome;
  dryRun?: boolean;
  postedUrl?: string;
  error?: string;
}

export interface RunSummary {
  runState?: AgentState;
  scouted: number;
  skipped: number;
  jobs: JobResult[];
  approved: number;
  aborted: number;
  failed: number;
}

/**
 * Map a runtime FanoutSummary + scouted opportunities into the
 * CommunityEngager-facing run summary (HITL outcomes, subreddit labels).
 */
export function runSummaryFromFanout(
  opportunities: CommunityDraft[],
  fanout: FanoutSummary | undefined,
  runState?: AgentState
): RunSummary {
  if (!fanout) {
    return {
      runState,
      scouted: opportunities.length,
      skipped: opportunities.length,
      jobs: [],
      approved: 0,
      aborted: 0,
      failed: 0,
    };
  }

  const byId = new Map(opportunities.map((o) => [o.id, o]));
  const jobs: JobResult[] = fanout.children.map((child) => {
    const draft = child.itemId ? byId.get(child.itemId) : undefined;
    const exec = child.executeResult as ExecuteResult | undefined;
    const hitl = child.hitlOutcome;
    let outcome: JobOutcome;
    if (child.outcome === "failed") outcome = "failed";
    else if (child.outcome === "aborted") outcome = "aborted";
    else if (hitl === "edited") outcome = "edited";
    else if (hitl === "approved" || child.outcome === "complete") {
      outcome = hitl === "edited" ? "edited" : "approved";
    } else outcome = "unknown";

    return {
      id: child.itemId ?? `job-${child.index + 1}`,
      subreddit: draft?.subreddit ?? "?",
      threadUrl: draft?.threadUrl ?? "",
      threadTitle: draft?.threadTitle ?? "",
      state: child.state,
      outcome,
      dryRun: exec?.dryRun,
      postedUrl: exec?.postedUrl,
      error: child.error,
    };
  });

  return {
    runState,
    scouted: opportunities.length,
    skipped: fanout.skipped,
    jobs,
    approved: jobs.filter(
      (j) => j.outcome === "approved" || j.outcome === "edited"
    ).length,
    aborted: jobs.filter((j) => j.outcome === "aborted").length,
    failed: jobs.filter((j) => j.outcome === "failed").length,
  };
}

/** Human-readable run summary for CLI / logs. */
export function formatRunSummary(summary: RunSummary): string {
  const lines = [
    `run=${summary.runState ?? "n/a"} scouted=${summary.scouted} processed=${summary.jobs.length} skipped=${summary.skipped}`,
    `approved=${summary.approved} aborted=${summary.aborted} failed=${summary.failed}`,
  ];
  for (const job of summary.jobs) {
    const extra = job.postedUrl
      ? ` → ${job.postedUrl}`
      : job.error
        ? ` — ${job.error}`
        : "";
    lines.push(`  [${job.outcome}] r/${job.subreddit} ${job.id}${extra}`);
  }
  return lines.join("\n");
}
