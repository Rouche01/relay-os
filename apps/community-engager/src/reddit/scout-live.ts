import { createHash } from "node:crypto";
import type { CommunityDraft } from "../types.js";
import { isActionable } from "../types.js";
import { RedditClient } from "./client.js";
import {
  allowlistedSubNames,
  getRedditEnv,
  type RedditEnvConfig,
} from "./config.js";
import { scoreRedditPost } from "./score.js";

export interface LiveScoutOptions {
  limit?: number;
  subreddits?: string[];
  cfg?: RedditEnvConfig;
}

/**
 * Read-only Reddit scout over allowlisted subs.
 * Refuses low scores (< 4/5). Never writes.
 */
export async function scoutRedditLive(
  opts: LiveScoutOptions = {}
): Promise<CommunityDraft[]> {
  const cfg = opts.cfg ?? getRedditEnv();
  if (!cfg.configured) {
    throw new Error("scoutRedditLive requires REDDIT_* credentials");
  }

  const client = new RedditClient(cfg);
  const subs = opts.subreddits?.length ? opts.subreddits : allowlistedSubNames();
  const limit = opts.limit ?? 5;
  const drafts: CommunityDraft[] = [];

  for (const sub of subs) {
    let posts;
    try {
      posts = await client.listNew(sub, 15);
    } catch (err) {
      console.warn(`[scout:reddit] r/${sub} failed:`, err);
      continue;
    }

    for (const post of posts) {
      const { score, rationale } = scoreRedditPost(post);
      if (!isActionable(score)) continue;

      const id = `reddit-${post.id}`;
      drafts.push({
        id,
        platform: "reddit",
        subreddit: post.subreddit,
        threadUrl: post.permalink,
        threadTitle: post.title,
        draftText: "",
        intensity: 0,
        score,
        rationale,
        status: "proposed",
        createdAt: new Date().toISOString(),
        utmCampaign: `community_${post.subreddit}`,
        redditThingId: post.name,
      });

      if (drafts.length >= limit) {
        return drafts;
      }
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
