import { isActionable } from "../../types.js";
import type { CommunityDraft } from "../../types.js";
import { FIXTURE_THREADS, fixtureToDraftSkeleton } from "../../fixtures/threads.js";
import {
  allowlistedSubNames,
  getCommunityConfig,
  isOauthScoutSource,
  isRedditApisScoutSource,
  type ScoutSource,
} from "../../reddit/config.js";
import type { PlaywrightEngine } from "@relay/engines-browser";
import {
  scoutRedditBrowser,
  type BrowserScoutBlocked,
  type BrowserScoutSubOutcome,
  type ScoutChallengeHandOff,
} from "../../reddit/scout/scout-browser.js";
import { scoutRedditJson } from "../../reddit/scout/scout-json.js";
import { scoutRedditLive } from "../../reddit/scout/scout-live.js";
import { scoutRedditApis } from "../../reddit/scout/scout-redditapis.js";
import {
  buildScoutReport,
  type ScoutReport,
  type ScoutSubReport,
} from "./scout-report.js";

export type { ScoutReport, ScoutSubReport, ScoutSubStatus } from "./scout-report.js";

export interface ScoutOptions {
  /** Max *new* actionable drafts to return (default 5). Already-seen excluded. */
  limit?: number;
  /** When true, include non-actionable fixtures (for debugging). */
  includeRejected?: boolean;
  /** Force source; default follows SCOUT_SOURCE env (auto). */
  source?: ScoutSource;
  /**
   * Subs to scout (memory/allowlist-backed). When omitted, each transport
   * falls back to the static seed allowlist.
   */
  subreddits?: string[];
  /**
   * Draft ids (`reddit-<id>`) already in the action-store — skipped so `limit`
   * counts fresh opportunities for this run only.
   */
  excludeIds?: Iterable<string>;
  /** Reuse headed browser after login HITL (caller owns teardown). */
  adopt?: { engine: PlaywrightEngine; storagePath: string };
  /** Subs already login-HITL'd this run — skip re-prompt, continue allowlist. */
  skipLoginHitlSubs?: string[];
}

export interface ScoutResult {
  drafts: CommunityDraft[];
  source: ScoutSource | "fixtures";
  blocked: BrowserScoutBlocked[];
  timedOut: string[];
  /** Structured per-sub outcomes for run logs. */
  report: ScoutReport;
  /** Live CAPTCHA window from browser scout — pause HITL before json fallback. */
  challenge?: ScoutChallengeHandOff;
}

function finish(
  source: ScoutSource | "fixtures",
  plannedSubs: string[],
  drafts: CommunityDraft[],
  blocked: BrowserScoutBlocked[],
  timedOut: string[],
  challenge?: ScoutChallengeHandOff,
  subOutcomes?: BrowserScoutSubOutcome[]
): ScoutResult {
  const subReports: ScoutSubReport[] | undefined = subOutcomes?.map((o) => ({
    subreddit: o.subreddit,
    status:
      o.status === "ok" && o.opportunities === 0
        ? ("empty" as const)
        : o.status,
    reason: o.reason,
    opportunities: o.opportunities,
    url: o.url,
  }));

  return {
    drafts,
    source,
    blocked,
    timedOut,
    challenge,
    report: buildScoutReport({
      source,
      plannedSubs,
      drafts,
      blocked,
      timedOut,
      challenge,
      subReports,
    }),
  };
}

/**
 * Opportunity finder.
 * - redditapis: third-party read-only listings (REDDITAPIS_API_KEY, no Reddit login)
 * - browser: Playwright + structured extract (no OAuth app)
 * - json: public *.json listings (no browser / no API app) — escape hatch
 * - reddit | oauth: OAuth allowlisted live read (requires REDDIT_CLIENT_*)
 * - fixtures: offline HITL dogfood
 * - auto: if redditapis key → redditapis → json → oauth → fixtures;
 *         else browser → json → oauth → fixtures
 */
export async function scoutOpportunities(
  opts: ScoutOptions = {}
): Promise<ScoutResult> {
  const cfg = getCommunityConfig();
  const source = opts.source ?? cfg.scout.source;
  const limit = opts.limit ?? 5;
  let blocked: BrowserScoutBlocked[] = [];
  let timedOut: string[] = [];
  let browserOutcomes: BrowserScoutSubOutcome[] | undefined;
  let browserPlanned: string[] | undefined;

  const plannedSubs =
    opts.subreddits?.length ? [...opts.subreddits] : allowlistedSubNames();
  const subreddits = opts.subreddits;
  const excludeIds = opts.excludeIds;
  if (subreddits?.length) {
    console.log(
      `[scout] subs=${subreddits.map((s) => `r/${s}`).join(", ")}`
    );
  }
  if (excludeIds) {
    const n = excludeIds instanceof Set ? excludeIds.size : [...excludeIds].length;
    if (n > 0) {
      console.log(`[scout] excluding ${n} already-seen draft id(s)`);
    }
  }

  const preferRedditApis =
    isRedditApisScoutSource(source) ||
    (source === "auto" && cfg.redditApis.configured);

  // --- redditapis (explicit or auto-when-keyed) ---
  if (preferRedditApis) {
    if (isRedditApisScoutSource(source) && !cfg.redditApis.configured) {
      throw new Error(
        "SCOUT_SOURCE=redditapis but REDDITAPIS_API_KEY is missing"
      );
    }
    console.log(
      "[scout] source=redditapis (Bearer key listings, score ≥ 5/8)"
    );
    try {
      const live = await scoutRedditApis({
        limit,
        cfg,
        subreddits,
        excludeIds,
      });
      if (live.length > 0) {
        return finish(
          "redditapis",
          plannedSubs,
          live,
          blocked,
          timedOut
        );
      }
      console.warn("[scout] redditapis returned 0 actionable");
      if (isRedditApisScoutSource(source)) {
        console.warn(
          "[scout] SCOUT_SOURCE=redditapis — falling back toward fixtures"
        );
      }
    } catch (err) {
      console.warn("[scout] redditapis scout failed:", err);
      if (isRedditApisScoutSource(source)) throw err;
    }
  }

  // Skip browser when auto prefers redditapis (avoid login walls / account flags).
  const tryBrowser =
    source === "browser" || (source === "auto" && !cfg.redditApis.configured);
  if (tryBrowser) {
    console.log(
      "[scout] source=browser (Playwright / www.reddit extract, score ≥ 5/8)"
    );
    try {
      const live = await scoutRedditBrowser({
        limit,
        cfg,
        subreddits,
        excludeIds,
        adopt: opts.adopt,
        skipLoginHitlSubs: opts.skipLoginHitlSubs,
      });
      blocked = live.blocked;
      timedOut = live.timedOut;
      browserOutcomes = live.subOutcomes;
      browserPlanned = live.plannedSubs;
      if (live.blocked.length > 0) {
        console.warn(
          `[scout] browser blocked ${live.blocked.length} sub(s): ${live.blocked
            .map((b) => `r/${b.subreddit}`)
            .join(", ")}`
        );
      }
      // CAPTCHA HITL owns the live window — do not fall through to json yet.
      if (live.challenge) {
        return finish(
          "browser",
          live.plannedSubs,
          live.drafts,
          blocked,
          timedOut,
          live.challenge,
          live.subOutcomes
        );
      }
      if (live.drafts.length > 0) {
        return finish(
          "browser",
          live.plannedSubs,
          live.drafts,
          blocked,
          timedOut,
          undefined,
          live.subOutcomes
        );
      }
      console.warn("[scout] browser returned 0 actionable");
    } catch (err) {
      console.warn("[scout] browser scout failed:", err);
      if (source === "browser") {
        console.warn("[scout] SCOUT_SOURCE=browser — falling back toward fixtures");
      }
    }
  }

  const planned = browserPlanned ?? plannedSubs;

  // Explicit redditapis: do not cascade into json/oauth (fixtures only below).
  const tryJson =
    source === "json" || source === "auto" || source === "browser";
  if (tryJson) {
    console.log("[scout] source=json (public *.json listings, score ≥ 5/8)");
    try {
      const live = await scoutRedditJson({
        limit,
        cfg,
        subreddits,
        excludeIds,
      });
      if (live.length > 0) {
        return finish("json", planned, live, blocked, timedOut, undefined, browserOutcomes);
      }
      console.warn("[scout] json returned 0 actionable");
    } catch (err) {
      console.warn("[scout] json scout failed:", err);
      if (source === "json") {
        console.warn("[scout] SCOUT_SOURCE=json — falling back toward fixtures");
      }
    }
  }

  const tryOauth =
    isOauthScoutSource(source) ||
    (source === "auto" && cfg.reddit.oauthConfigured) ||
    ((source === "json" || source === "browser") &&
      cfg.reddit.oauthConfigured);

  if (tryOauth) {
    if (isOauthScoutSource(source) && !cfg.reddit.oauthConfigured) {
      throw new Error(
        "SCOUT_SOURCE=reddit|oauth but REDDIT_CLIENT_* OAuth credentials are missing"
      );
    }
    console.log("[scout] source=reddit (OAuth allowlisted subs, score ≥ 5/8)");
    try {
      const live = await scoutRedditLive({
        limit,
        cfg,
        subreddits,
        excludeIds,
      });
      if (live.length > 0) {
        return finish("oauth", planned, live, blocked, timedOut, undefined, browserOutcomes);
      }
      console.warn(
        "[scout] oauth reddit returned 0 actionable; falling back to fixtures"
      );
    } catch (err) {
      console.warn("[scout] oauth reddit failed:", err);
      if (isOauthScoutSource(source)) throw err;
    }
  }

  console.log("[scout] source=fixtures");
  const exclude = new Set(excludeIds ?? []);
  const drafts = FIXTURE_THREADS.map((t) => fixtureToDraftSkeleton(t));
  const filtered = opts.includeRejected
    ? drafts
    : drafts.filter((d) => isActionable(d.score));
  const fresh = filtered.filter((d) => !exclude.has(d.id));
  return finish(
    "fixtures",
    planned,
    fresh.slice(0, limit),
    blocked,
    timedOut,
    undefined,
    browserOutcomes
  );
}
