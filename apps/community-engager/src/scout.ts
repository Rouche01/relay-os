import { isActionable } from "./types.js";
import type { CommunityDraft } from "./types.js";
import { FIXTURE_THREADS, fixtureToDraftSkeleton } from "./fixtures/threads.js";
import {
  getRedditEnv,
  isOauthScoutSource,
  type ScoutSource,
} from "./reddit/config.js";
import { scoutRedditBrowser } from "./reddit/scout-browser.js";
import { scoutRedditLive } from "./reddit/scout-live.js";

export interface ScoutOptions {
  /** Max actionable drafts to return (default 5). */
  limit?: number;
  /** When true, include non-actionable fixtures (for debugging). */
  includeRejected?: boolean;
  /** Force source; default follows SCOUT_SOURCE env (auto). */
  source?: ScoutSource;
}

/**
 * Opportunity finder.
 * - browser: Playwright + structured extract (no OAuth app)
 * - reddit | oauth: OAuth allowlisted live read (requires REDDIT_CLIENT_*)
 * - json: reserved (Phase 4) — falls through
 * - fixtures: offline HITL dogfood
 * - auto: browser → oauth (if configured) → fixtures
 */
export async function scoutOpportunities(
  opts: ScoutOptions = {}
): Promise<CommunityDraft[]> {
  const cfg = getRedditEnv();
  const source = opts.source ?? cfg.scoutSource;
  const limit = opts.limit ?? 5;

  if (source === "json") {
    console.warn(
      "[scout] SCOUT_SOURCE=json is not implemented yet (Phase 4); continuing auto-style fallbacks"
    );
  }

  const tryBrowser =
    source === "browser" || source === "auto" || source === "json";
  if (tryBrowser) {
    console.log(
      "[scout] source=browser (Playwright / www.reddit extract, score ≥ 4)"
    );
    try {
      const live = await scoutRedditBrowser({ limit, cfg });
      if (live.length > 0) return live;
      console.warn("[scout] browser returned 0 actionable");
    } catch (err) {
      console.warn("[scout] browser scout failed:", err);
      if (source === "browser") {
        console.warn("[scout] SCOUT_SOURCE=browser — falling back to fixtures");
      }
    }
  }

  const tryOauth =
    isOauthScoutSource(source) ||
    (source === "auto" && cfg.oauthConfigured) ||
    (source === "json" && cfg.oauthConfigured);

  if (tryOauth) {
    if (isOauthScoutSource(source) && !cfg.oauthConfigured) {
      throw new Error(
        "SCOUT_SOURCE=reddit|oauth but REDDIT_CLIENT_* OAuth credentials are missing"
      );
    }
    console.log("[scout] source=reddit (OAuth allowlisted subs, score ≥ 4)");
    try {
      const live = await scoutRedditLive({ limit, cfg });
      if (live.length > 0) return live;
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
  return filtered.slice(0, limit);
}
