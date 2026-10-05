import { createHash } from "node:crypto";
import type { CommunityDraft } from "../types.js";
import { RedditClient } from "./client.js";
import {
  allowlistedSubNames,
  getRedditEnv,
  type RedditEnvConfig,
} from "./config.js";
import { listingPostsToDrafts } from "./map-drafts.js";

export interface LiveScoutOptions {
  limit?: number;
  subreddits?: string[];
  cfg?: RedditEnvConfig;
  /** Already-seen draft ids — skipped so `limit` is fresh for this run. */
  excludeIds?: Iterable<string>;
}

/**
 * Read-only Reddit scout over allowlisted subs (OAuth).
 * Refuses low scores (< 4/5). Never writes.
 */
export async function scoutRedditLive(
  opts: LiveScoutOptions = {}
): Promise<CommunityDraft[]> {
  const cfg = opts.cfg ?? getRedditEnv();
  if (!cfg.oauthConfigured && !cfg.configured) {
    throw new Error("scoutRedditLive requires REDDIT_* OAuth credentials");
  }

  const client = new RedditClient(cfg);
  const subs = opts.subreddits?.length ? opts.subreddits : allowlistedSubNames();
  const limit = opts.limit ?? 5;
  const drafts: CommunityDraft[] = [];
  const excludeIds = new Set(opts.excludeIds ?? []);

  for (const sub of subs) {
    let posts;
    try {
      posts = await client.listNew(sub, 15);
    } catch (err) {
      console.warn(`[scout:reddit] r/${sub} failed:`, err);
      continue;
    }

    const mapped = listingPostsToDrafts(posts, limit - drafts.length, {
      excludeIds,
    });
    for (const d of mapped) excludeIds.add(d.id);
    drafts.push(...mapped);
    if (drafts.length >= limit) {
      return drafts;
    }
  }

  return drafts;
}

/** Stable job id for idempotent execute. */
export function executeJobId(draft: CommunityDraft): string {
  const h = createHash("sha256")
    .update(`${draft.id}\n${draft.draftText}\n${draft.threadUrl}`)
    .digest("hex")
    .slice(0, 16);
  return `post:${draft.id}:${h}`;
}
