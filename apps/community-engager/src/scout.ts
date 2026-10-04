import { isActionable } from "./types.js";
import type { CommunityDraft } from "./types.js";
import { FIXTURE_THREADS, fixtureToDraftSkeleton } from "./fixtures/threads.js";
import {
  getRedditEnv,
  isOauthScoutSource,
  type ScoutSource,
} from "./reddit/config.js";
import {
  scoutRedditBrowser,
  type BrowserScoutBlocked,
} from "./reddit/scout-browser.js";
import { scoutRedditJson } from "./reddit/scout-json.js";
import { scoutRedditLive } from "./reddit/scout-live.js";

export interface ScoutOptions {
  /** Max actionable drafts to return (default 5). */
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
}

export interface ScoutResult {
  drafts: CommunityDraft[];
  source: ScoutSource | "fixtures";
  blocked: BrowserScoutBlocked[];
  timedOut: string[];
}

/**
 * Opportunity finder.
 * - browser: Playwright + structured extract (no OAuth app)
 * - json: public *.json listings (no browser / no API app) — escape hatch
 * - reddit | oauth: OAuth allowlisted live read (requires REDDIT_CLIENT_*)
 * - fixtures: offline HITL dogfood
 * - auto: browser → json → oauth (if configured) → fixtures
 */
export async function scoutOpportunities(
  opts: ScoutOptions = {}
): Promise<ScoutResult> {
  const cfg = getRedditEnv();
  const source = opts.source ?? cfg.scoutSource;
  const limit = opts.limit ?? 5;
  let blocked: BrowserScoutBlocked[] = [];
  let timedOut: string[] = [];

  const subreddits = opts.subreddits;
  if (subreddits?.length) {
    console.log(
      `[scout] subs=${subreddits.map((s) => `r/${s}`).join(", ")}`
    );
  }

  const tryBrowser = source === "browser" || source === "auto";
  if (tryBrowser) {
    console.log(
      "[scout] source=browser (Playwright / www.reddit extract, score ≥ 4)"
    );
    try {
      const live = await scoutRedditBrowser({ limit, cfg, subreddits });
      blocked = live.blocked;
      timedOut = live.timedOut;
      if (live.blocked.length > 0) {
        console.warn(
          `[scout] browser blocked ${live.blocked.length} sub(s): ${live.blocked
            .map((b) => `r/${b.subreddit}`)
            .join(", ")}`
        );
      }
      if (live.drafts.length > 0) {
        return { drafts: live.drafts, source: "browser", blocked, timedOut };
      }
      console.warn("[scout] browser returned 0 actionable");
    } catch (err) {
      console.warn("[scout] browser scout failed:", err);
      if (source === "browser") {
        console.warn("[scout] SCOUT_SOURCE=browser — falling back toward fixtures");
      }
    }
  }

  const tryJson = source === "json" || source === "auto" || source === "browser";
  if (tryJson) {
    console.log("[scout] source=json (public *.json listings, score ≥ 4)");
    try {
      const live = await scoutRedditJson({ limit, cfg, subreddits });
      if (live.length > 0) {
        return { drafts: live, source: "json", blocked, timedOut };
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
    (source === "auto" && cfg.oauthConfigured) ||
    ((source === "json" || source === "browser") && cfg.oauthConfigured);

  if (tryOauth) {
    if (isOauthScoutSource(source) && !cfg.oauthConfigured) {
      throw new Error(
        "SCOUT_SOURCE=reddit|oauth but REDDIT_CLIENT_* OAuth credentials are missing"
      );
    }
    console.log("[scout] source=reddit (OAuth allowlisted subs, score ≥ 4)");
    try {
      const live = await scoutRedditLive({ limit, cfg, subreddits });
      if (live.length > 0) {
        return { drafts: live, source: "oauth", blocked, timedOut };
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
  const drafts = FIXTURE_THREADS.map((t) => fixtureToDraftSkeleton(t));
  const filtered = opts.includeRejected
    ? drafts
    : drafts.filter((d) => isActionable(d.score));
  return {
    drafts: filtered.slice(0, limit),
    source: "fixtures",
    blocked,
    timedOut,
  };
}
