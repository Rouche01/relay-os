import { isActionable } from "./types.js";
import type { CommunityDraft } from "./types.js";
import { FIXTURE_THREADS, fixtureToDraftSkeleton } from "./fixtures/threads.js";
import { getRedditEnv } from "./reddit/config.js";
import { scoutRedditLive } from "./reddit/scout-live.js";

export interface ScoutOptions {
  /** Max actionable drafts to return (default 5). */
  limit?: number;
  /** When true, include non-actionable fixtures (for debugging). */
  includeRejected?: boolean;
  /** Force source; default follows SCOUT_SOURCE env (auto). */
  source?: "fixtures" | "reddit" | "auto";
}

/**
 * Opportunity finder.
 * - fixtures: offline HITL dogfood
 * - reddit: allowlisted live read (requires REDDIT_*)
 * - auto: reddit when configured, else fixtures
 */
export async function scoutOpportunities(
  opts: ScoutOptions = {}
): Promise<CommunityDraft[]> {
  const cfg = getRedditEnv();
  const source = opts.source ?? cfg.scoutSource;
  const useReddit =
    source === "reddit" || (source === "auto" && cfg.configured);

  if (useReddit) {
    if (!cfg.configured) {
      throw new Error("SCOUT_SOURCE=reddit but REDDIT_* credentials are missing");
    }
    console.log("[scout] source=reddit (allowlisted subs, score ≥ 4)");
    const live = await scoutRedditLive({ limit: opts.limit ?? 5, cfg });
    if (live.length > 0) return live;
    console.warn("[scout] reddit returned 0 actionable; falling back to fixtures");
  }

  console.log("[scout] source=fixtures");
  const limit = opts.limit ?? 5;
  const drafts = FIXTURE_THREADS.map((t) => fixtureToDraftSkeleton(t));
  const filtered = opts.includeRejected
    ? drafts
    : drafts.filter((d) => isActionable(d.score));
  return filtered.slice(0, limit);
}
