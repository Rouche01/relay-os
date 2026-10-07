import type { AgentState } from "@relay/protocol";
import type { FanoutSummary } from "@relay/runtime";
import type { ExecuteResult } from "./executor.js";
import type { ScoutReport } from "./scout-report.js";
import type { CommunityDraft } from "./types.js";
import {
  buildGoalChecklist,
  type DiscoverEvidence,
  type DraftEvidence,
  type ExecuteEvidence,
  type GoalChecklist,
  type HitlEvidence,
  type MemoryWriteEvidence,
  type SessionEvidence,
} from "./run-evidence.js";

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
  draft?: DraftEvidence;
  hitl?: HitlEvidence;
  execute?: ExecuteEvidence;
  memory?: MemoryWriteEvidence;
}

export interface RunSummary {
  runState?: AgentState;
  scouted: number;
  skipped: number;
  jobs: JobResult[];
  approved: number;
  aborted: number;
  failed: number;
  /** Per-subreddit scout outcomes (blocked walls, timeouts, opportunity counts). */
  scout?: ScoutReport;
  /** Parent ensure_session evidence. */
  session?: SessionEvidence;
  /** Parent discover evidence. */
  discover?: DiscoverEvidence;
  /** Goal-verification checklist for analysis. */
  goals?: GoalChecklist;
}

export interface RunSummaryExtras {
  session?: SessionEvidence;
  discover?: DiscoverEvidence;
}

function executeFromChild(
  child: FanoutSummary["children"][number]
): ExecuteEvidence | undefined {
  const fromStages = child.stageResults?.execute as ExecuteEvidence | undefined;
  if (fromStages) return fromStages;
  const exec = child.executeResult as ExecuteResult | undefined;
  if (!exec) return undefined;
  return {
    ok: exec.ok,
    dryRun: exec.dryRun,
    jobId: exec.jobId,
    transport: exec.transport,
    postedUrl: exec.postedUrl,
    idempotentHit: exec.idempotentHit,
    error: exec.error,
  };
}

function memoryFromChild(
  child: FanoutSummary["children"][number]
): MemoryWriteEvidence | undefined {
  const learn = child.stageResults?.learn as
    | { memory?: MemoryWriteEvidence }
    | undefined;
  return learn?.memory;
}

/**
 * Map a runtime FanoutSummary + scouted opportunities into the
 * CommunityEngager-facing run summary (HITL outcomes, subreddit labels).
 */
export function runSummaryFromFanout(
  opportunities: CommunityDraft[],
  fanout: FanoutSummary | undefined,
  runState?: AgentState,
  scout?: ScoutReport,
  extras?: RunSummaryExtras
): RunSummary {
  if (!fanout) {
    const empty: RunSummary = {
      runState,
      scouted: opportunities.length,
      skipped: opportunities.length,
      jobs: [],
      approved: 0,
      aborted: 0,
      failed: 0,
      scout,
      session: extras?.session,
      discover: extras?.discover,
    };
    empty.goals = buildGoalChecklist({
      session: empty.session,
      scout: empty.scout,
      jobs: [],
    });
    return empty;
  }

  const byId = new Map(opportunities.map((o) => [o.id, o]));
  const jobs: JobResult[] = fanout.children.map((child) => {
    const draft = child.itemId ? byId.get(child.itemId) : undefined;
    const hitl = child.hitlOutcome;
    let outcome: JobOutcome;
    if (child.outcome === "failed") outcome = "failed";
    else if (child.outcome === "aborted") outcome = "aborted";
    else if (hitl === "edited") outcome = "edited";
    else if (hitl === "approved" || child.outcome === "complete") {
      outcome = hitl === "edited" ? "edited" : "approved";
    } else outcome = "unknown";

    const execute = executeFromChild(child);
    const hitlEvidence = child.stageResults?.hitl as HitlEvidence | undefined;
    const draftEvidence = child.stageResults?.draft as DraftEvidence | undefined;
    const memory = memoryFromChild(child);

    return {
      id: child.itemId ?? `job-${child.index + 1}`,
      subreddit: draft?.subreddit ?? "?",
      threadUrl: draft?.threadUrl ?? "",
      threadTitle: draft?.threadTitle ?? "",
      state: child.state,
      outcome,
      dryRun: execute?.dryRun,
      postedUrl: execute?.postedUrl,
      error: child.error,
      draft: draftEvidence,
      hitl: hitlEvidence,
      execute,
      memory,
    };
  });

  const summary: RunSummary = {
    runState,
    scouted: opportunities.length,
    skipped: fanout.skipped,
    jobs,
    approved: jobs.filter(
      (j) => j.outcome === "approved" || j.outcome === "edited"
    ).length,
    aborted: jobs.filter((j) => j.outcome === "aborted").length,
    failed: jobs.filter((j) => j.outcome === "failed").length,
    scout,
    session: extras?.session,
    discover: extras?.discover,
  };

  summary.goals = buildGoalChecklist({
    session: summary.session,
    scout: summary.scout,
    jobs: summary.jobs.map((j) => ({
      outcome: j.outcome,
      hitl: j.hitl,
      execute: j.execute,
      memory: j.memory,
    })),
  });

  return summary;
}

/** Human-readable run summary for CLI / logs. */
export function formatRunSummary(summary: RunSummary): string {
  const lines = [
    `run=${summary.runState ?? "n/a"} scouted=${summary.scouted} processed=${summary.jobs.length} skipped=${summary.skipped}`,
    `approved=${summary.approved} aborted=${summary.aborted} failed=${summary.failed}`,
  ];
  if (summary.session) {
    const s = summary.session;
    lines.push(
      `session ok=${s.ok} source=${s.source ?? "?"} challenged=${Boolean(s.challenged)}` +
        (s.error ? ` error=${s.error}` : "")
    );
  }
  if (summary.discover) {
    const d = summary.discover;
    const discoverParts = [
      `discover enabled=${d.enabled} ran=${d.ran} candidates=${d.candidateCount}`,
      `decision=${d.decision ?? "none"}`,
    ];
    if (d.promotedNames?.length) {
      discoverParts.push(`promoted=${d.promotedNames.join(",")}`);
    } else if (d.promoted) {
      discoverParts.push(`promoted=${d.promoted}`);
    }
    if (d.hitlWaitMs != null) discoverParts.push(`hitlWaitMs=${d.hitlWaitMs}`);
    if (d.skippedReason) discoverParts.push(`skip=${d.skippedReason}`);
    if (d.memory?.attempted) {
      discoverParts.push(
        `memory=${d.memory.ok ? "ok" : "fail"}` +
          (d.memory.eventId ? ` event=${d.memory.eventId}` : "") +
          (d.memory.action ? ` action=${d.memory.action}` : "")
      );
    }
    lines.push(discoverParts.join(" "));
  }
  if (summary.scout) {
    const s = summary.scout;
    lines.push(
      `scout source=${s.source} listingOk=${s.listingOk} foundOpportunities=${s.foundOpportunities} ` +
        `blocked=${s.blockedCount} timedOut=${s.timedOutCount}`
    );
    if (s.challengeSubreddit) {
      lines.push(
        `  challenge r/${s.challengeSubreddit} (${s.challengeReason ?? "?"})`
      );
    }
    for (const sub of s.subs) {
      const detail =
        sub.status === "blocked" || sub.status === "error"
          ? ` · ${sub.reason ?? "?"}`
          : sub.opportunities
            ? ` · ${sub.opportunities} opp`
            : "";
      lines.push(`  [scout:${sub.status}] r/${sub.subreddit}${detail}`);
    }
  }
  for (const job of summary.jobs) {
    const parts: string[] = [];
    if (job.draft?.provider) parts.push(`draft=${job.draft.provider}`);
    if (job.hitl?.waitMs != null) parts.push(`hitlWaitMs=${job.hitl.waitMs}`);
    if (job.execute?.transport) parts.push(`transport=${job.execute.transport}`);
    if (job.execute?.idempotentHit) parts.push("idempotent");
    if (job.memory?.attempted) {
      parts.push(`memory=${job.memory.ok ? "ok" : "fail"}`);
      if (job.memory.eventId) parts.push(`event=${job.memory.eventId}`);
      if (job.memory.action) parts.push(`action=${job.memory.action}`);
    }
    const meta = parts.length ? ` (${parts.join(" ")})` : "";
    const extra = job.postedUrl
      ? ` → ${job.postedUrl}`
      : job.error
        ? ` — ${job.error}`
        : "";
    lines.push(`  [${job.outcome}] r/${job.subreddit} ${job.id}${meta}${extra}`);
  }
  if (summary.goals) {
    const g = summary.goals;
    lines.push(
      `goals sessionOk=${g.sessionOk} scoutListingOk=${g.scoutListingOk} ` +
        `scoutFoundOpportunities=${g.scoutFoundOpportunities} hitlDecided=${g.hitlDecided} ` +
        `noLivePostWithoutApprove=${g.noLivePostWithoutApprove} memoryWriteOk=${g.memoryWriteOk} ` +
        `goalMet=${g.goalMet}`
    );
  }
  return lines.join("\n");
}
