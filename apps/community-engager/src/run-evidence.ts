import type { PromoIntensity } from "./types.js";
import type { ScoutReport } from "./scout-report.js";

/** Parent-run session stage evidence. */
export interface SessionEvidence {
  ok: boolean;
  source?: "jar" | "env" | "hitl" | "deferred";
  challenged?: boolean;
  error?: string;
}

/** Parent-run discover stage evidence. */
export interface DiscoverEvidence {
  enabled: boolean;
  ran: boolean;
  skippedReason?: string;
  candidateCount: number;
  candidateNames: string[];
  /** promote | skip | abort | none */
  decision?: "promote" | "skip" | "abort" | "none";
  promoted?: string;
  captcha?: string;
  /** ms waiting on discover HITL (CAPTCHA / choice), if any. */
  hitlWaitMs?: number;
  /** VoltMem write on promote (addEvent). */
  memory?: MemoryWriteEvidence;
}

export type DraftProvider = "gemini" | "stub";

export interface DraftEvidence {
  id: string;
  subreddit: string;
  scoreTotal: number;
  intensity: PromoIntensity;
  memoryUsed: boolean;
  memoryChars: number;
  /** Who wrote draftText. */
  provider: DraftProvider;
  draftChars: number;
  /** Single-line excerpt of the proposed reply. */
  preview?: string;
}

const PREVIEW_MAX = 140;

/** Collapse whitespace and cap a reply for run logs. */
export function draftPreview(text: string, max = PREVIEW_MAX): string | undefined {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return undefined;
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1)}…`;
}

export interface HitlEvidence {
  outcome?: string;
  /** ms from feedback request → applied (await_approval). */
  waitMs?: number;
  /** Extra confirmation for intensity-2, if any. */
  intensity2Confirmed?: boolean;
}

export interface ExecuteEvidence {
  ok: boolean;
  dryRun: boolean;
  jobId: string;
  transport?: string;
  postedUrl?: string;
  idempotentHit?: boolean;
  error?: string;
}

export interface MemoryWriteEvidence {
  attempted: boolean;
  ok?: boolean;
  domain?: string;
  outcome?: string;
  /** VoltMem event id when written via addEvent. */
  eventId?: string;
  /** First facet WriteResult.action (e.g. inserted). */
  action?: string;
}

/** Per-job evidence collected on the child runtime context. */
export interface JobEvidence {
  draft?: DraftEvidence;
  hitl?: HitlEvidence;
  execute?: ExecuteEvidence;
  memory?: MemoryWriteEvidence;
}

export interface GoalChecklist {
  /** Cookie jar / login path did not hard-fail (ok or deferred). */
  sessionOk: boolean;
  /** Scout extracted at least one listing without only walls (or fixtures/json ok). */
  scoutListingOk: boolean;
  /** At least one actionable opportunity (score ≥ 4). */
  scoutFoundOpportunities: boolean;
  /** Every processed job got a HITL decision (approve/edit/abort) or failed earlier. */
  hitlDecided: boolean;
  /** No live post when dry-run; live posts only after approve/edit. */
  noLivePostWithoutApprove: boolean;
  /** VoltMem write attempted for decided jobs succeeded (or none attempted). */
  memoryWriteOk: boolean;
  /** All checklist items true. */
  goalMet: boolean;
}

export function buildGoalChecklist(input: {
  session?: SessionEvidence;
  scout?: ScoutReport;
  jobs: Array<{
    outcome: string;
    hitl?: HitlEvidence;
    execute?: ExecuteEvidence;
    memory?: MemoryWriteEvidence;
  }>;
  dryRunDefault?: boolean;
}): GoalChecklist {
  const sessionOk = input.session?.ok !== false;
  const scoutListingOk = input.scout ? input.scout.listingOk : true;
  const scoutFoundOpportunities = input.scout
    ? input.scout.foundOpportunities
    : input.jobs.length > 0;

  const decided = input.jobs.filter((j) =>
    ["approved", "edited", "aborted"].includes(j.outcome)
  );
  const hitlDecided =
    input.jobs.length === 0 ||
    input.jobs.every(
      (j) =>
        j.outcome === "failed" ||
        j.outcome === "unknown" ||
        ["approved", "edited", "aborted"].includes(j.outcome)
    );

  let noLivePostWithoutApprove = true;
  for (const j of input.jobs) {
    const ex = j.execute;
    if (!ex) continue;
    if (ex.dryRun) continue;
    if (ex.ok && ex.postedUrl) {
      if (j.outcome !== "approved" && j.outcome !== "edited") {
        noLivePostWithoutApprove = false;
      }
    }
  }

  const memoryWrites = decided
    .map((j) => j.memory)
    .filter((m): m is MemoryWriteEvidence => Boolean(m?.attempted));
  const memoryWriteOk =
    memoryWrites.length === 0 || memoryWrites.every((m) => m.ok === true);

  const goalMet =
    sessionOk &&
    scoutListingOk &&
    (scoutFoundOpportunities || input.jobs.length === 0) &&
    hitlDecided &&
    noLivePostWithoutApprove &&
    memoryWriteOk;

  return {
    sessionOk,
    scoutListingOk,
    scoutFoundOpportunities,
    hitlDecided,
    noLivePostWithoutApprove,
    memoryWriteOk,
    goalMet,
  };
}
