import type { CommunityDraft } from "./types.js";
import type { ScoutSource } from "./reddit/config.js";
import type {
  BrowserScoutBlocked,
  ScoutChallengeHandOff,
} from "./reddit/scout-browser.js";

/** Per-subreddit scout outcome for run logs / analysis. */
export type ScoutSubStatus =
  | "ok"
  | "blocked"
  | "timed_out"
  | "error"
  | "skipped"
  | "empty";

export interface ScoutSubReport {
  subreddit: string;
  status: ScoutSubStatus;
  /** Wall / error reason when status is blocked or error. */
  reason?: string;
  /** Actionable drafts kept from this sub for the run. */
  opportunities: number;
  url?: string;
}

export interface ScoutReport {
  source: ScoutSource | "fixtures";
  /** Allowlist slice we intended to visit. */
  plannedSubs: string[];
  /** One row per planned sub (skipped = not reached). */
  subs: ScoutSubReport[];
  opportunityCount: number;
  /** At least one sub extracted a listing without a wall. */
  listingOk: boolean;
  /** At least one actionable draft (score ≥ 4). */
  foundOpportunities: boolean;
  blockedCount: number;
  timedOutCount: number;
  challengeReason?: string;
  challengeSubreddit?: string;
}

export function buildScoutReport(input: {
  source: ScoutSource | "fixtures";
  plannedSubs: string[];
  drafts: CommunityDraft[];
  blocked?: BrowserScoutBlocked[];
  timedOut?: string[];
  challenge?: Pick<ScoutChallengeHandOff, "reason" | "subreddit">;
  /** Prefer browser-emitted rows when present. */
  subReports?: ScoutSubReport[];
}): ScoutReport {
  const planned = input.plannedSubs.map((s) =>
    s.replace(/^r\//i, "").toLowerCase()
  );
  const plannedDisplay = input.plannedSubs.map((s) =>
    s.replace(/^r\//i, "")
  );

  const bySubDrafts = new Map<string, number>();
  for (const d of input.drafts) {
    const key = d.subreddit.replace(/^r\//i, "").toLowerCase();
    bySubDrafts.set(key, (bySubDrafts.get(key) ?? 0) + 1);
  }

  let subs: ScoutSubReport[];
  if (input.subReports?.length) {
    const seen = new Set(
      input.subReports.map((r) => r.subreddit.replace(/^r\//i, "").toLowerCase())
    );
    subs = [
      ...input.subReports.map((r) => ({
        ...r,
        opportunities:
          r.opportunities ||
          bySubDrafts.get(r.subreddit.replace(/^r\//i, "").toLowerCase()) ||
          0,
      })),
    ];
    for (let i = 0; i < planned.length; i++) {
      const key = planned[i]!;
      if (seen.has(key)) continue;
      subs.push({
        subreddit: plannedDisplay[i]!,
        status: "skipped",
        opportunities: 0,
      });
    }
  } else {
    const blockedMap = new Map(
      (input.blocked ?? []).map((b) => [
        b.subreddit.replace(/^r\//i, "").toLowerCase(),
        b,
      ])
    );
    const timedOut = new Set(
      (input.timedOut ?? []).map((s) => s.replace(/^r\//i, "").toLowerCase())
    );
    subs = plannedDisplay.map((name, i) => {
      const key = planned[i]!;
      const block = blockedMap.get(key);
      if (block) {
        return {
          subreddit: name,
          status: "blocked" as const,
          reason: block.reason,
          opportunities: 0,
          url: block.url,
        };
      }
      if (timedOut.has(key)) {
        return {
          subreddit: name,
          status: "timed_out" as const,
          opportunities: 0,
        };
      }
      const n = bySubDrafts.get(key) ?? 0;
      return {
        subreddit: name,
        status: (n > 0 ? "ok" : "empty") as ScoutSubStatus,
        opportunities: n,
      };
    });
  }

  const blockedCount = subs.filter((s) => s.status === "blocked").length;
  const timedOutCount = subs.filter((s) => s.status === "timed_out").length;
  const listingOk = subs.some(
    (s) => s.status === "ok" || s.status === "empty"
  );
  const opportunityCount = input.drafts.length;

  return {
    source: input.source,
    plannedSubs: plannedDisplay,
    subs,
    opportunityCount,
    listingOk,
    foundOpportunities: opportunityCount > 0,
    blockedCount,
    timedOutCount,
    challengeReason: input.challenge?.reason,
    challengeSubreddit: input.challenge?.subreddit,
  };
}
