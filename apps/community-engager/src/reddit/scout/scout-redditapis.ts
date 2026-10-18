import { getAllowlistStore } from "../../policy/allowlist-store.js";
import { playbookLookup } from "../../policy/playbook.js";
import type { CommunityDraft } from "../../types.js";
import { RedditApisClient } from "../redditapis/client.js";
import {
  allowlistedSubNames,
  getCommunityConfig,
  type CommunityRuntimeConfig,
} from "../config.js";
import { listingPostsToDrafts } from "./map-drafts.js";

export interface RedditApisScoutOptions {
  limit?: number;
  subreddits?: string[];
  cfg?: CommunityRuntimeConfig;
  /** Already-seen draft ids — skipped so `limit` is fresh for this run. */
  excludeIds?: Iterable<string>;
  /** Override inter-sub delay (default cfg.scout.delayMs). */
  delayMs?: number;
  /** Injected client (tests). */
  client?: RedditApisClient;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Read-only scout via redditapis.com (Bearer key only — no Reddit session).
 * Reuses {@link listingPostsToDrafts} / score. Never writes.
 */
export async function scoutRedditApis(
  opts: RedditApisScoutOptions = {}
): Promise<CommunityDraft[]> {
  const cfg = opts.cfg ?? getCommunityConfig();
  if (!cfg.redditApis.configured) {
    throw new Error(
      "scoutRedditApis requires REDDITAPIS_API_KEY (read-only scout key)"
    );
  }

  const client = opts.client ?? new RedditApisClient(cfg.redditApis);
  const subs = opts.subreddits?.length ? opts.subreddits : allowlistedSubNames();
  const limit = opts.limit ?? 5;
  const delayMs = opts.delayMs ?? cfg.scout.delayMs;
  const drafts: CommunityDraft[] = [];
  const excludeIds = new Set(opts.excludeIds ?? []);
  const playbookFor = playbookLookup(await getAllowlistStore().playbookMap());

  for (let i = 0; i < subs.length; i++) {
    const sub = subs[i]!;
    console.log(`[scout:redditapis] r/${sub}`);

    let posts;
    try {
      posts = await client.listNew(sub, 15);
    } catch (err) {
      console.warn(`[scout:redditapis] r/${sub} failed:`, err);
      if (i < subs.length - 1 && delayMs > 0) await sleep(delayMs);
      continue;
    }

    console.log(
      `[scout:redditapis] r/${sub} extracted ${posts.length} posts`
    );
    const mapped = listingPostsToDrafts(posts, limit - drafts.length, {
      excludeIds,
      playbookFor,
    });
    for (const d of mapped) excludeIds.add(d.id);
    drafts.push(...mapped);
    if (drafts.length >= limit) return drafts;

    if (i < subs.length - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  return drafts;
}
