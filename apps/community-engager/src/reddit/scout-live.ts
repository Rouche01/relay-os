import { createHash } from "node:crypto";
import { getAllowlistStore } from "../allowlist-store.js";
import { playbookLookup } from "../playbook.js";
import type { CommunityDraft } from "../types.js";
import { RedditClient } from "./client.js";
import {
  allowlistedSubNames,
  getCommunityConfig,
  type CommunityRuntimeConfig,
} from "./config.js";
import { listingPostsToDrafts } from "./map-drafts.js";

export interface LiveScoutOptions {
  limit?: number;
  subreddits?: string[];
  cfg?: CommunityRuntimeConfig;
  /** Already-seen draft ids — skipped so `limit` is fresh for this run. */
  excludeIds?: Iterable<string>;
}

/**
 * Read-only Reddit scout over allowlisted subs (OAuth).
 * Refuses low scores (< 5/8). Never writes.
 */
export async function scoutRedditLive(
  opts: LiveScoutOptions = {}
): Promise<CommunityDraft[]> {
  const cfg = opts.cfg ?? getCommunityConfig();
  if (!cfg.reddit.oauthConfigured && !cfg.reddit.configured) {
    throw new Error("scoutRedditLive requires REDDIT_* OAuth credentials");
  }

  const client = new RedditClient(cfg.reddit);
  const subs = opts.subreddits?.length ? opts.subreddits : allowlistedSubNames();
  const limit = opts.limit ?? 5;
  const drafts: CommunityDraft[] = [];
  const excludeIds = new Set(opts.excludeIds ?? []);
  const playbookFor = playbookLookup(await getAllowlistStore().playbookMap());

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
      playbookFor,
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
