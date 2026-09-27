import { isActionable } from "./types.js";
import type { CommunityDraft } from "./types.js";
import { FIXTURE_THREADS, fixtureToDraftSkeleton } from "./fixtures/threads.js";

export interface ScoutOptions {
  /** Max actionable drafts to return (default 5). */
  limit?: number;
  /** When true, include non-actionable fixtures (for debugging). */
  includeRejected?: boolean;
}

/**
 * Read-only opportunity finder.
 * v1: checked-in fixtures so HITL works offline. Reddit API comes in Phase 2.
 */
export async function scoutOpportunities(
  opts: ScoutOptions = {}
): Promise<CommunityDraft[]> {
  const limit = opts.limit ?? 5;
  const drafts = FIXTURE_THREADS.map((t) => fixtureToDraftSkeleton(t));

  const filtered = opts.includeRejected
    ? drafts
    : drafts.filter((d) => isActionable(d.score));

  return filtered.slice(0, limit);
}
