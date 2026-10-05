import type { CommunityDraft } from "../types.js";
import { isActionable, scoreTotal } from "../types.js";
import type { RedditListingPost } from "./client.js";
import { HELP_RE, isMegathread, scoreRedditPost } from "./score.js";

export interface ListingScoreStats {
  scanned: number;
  actionable: number;
  nearMiss: number;
  megathreads: number;
}

/** Map scored listing posts into draft skeletons (shared by OAuth + browser scout). */
export function listingPostsToDrafts(
  posts: RedditListingPost[],
  limit: number,
  opts?: { excludeIds?: ReadonlySet<string> }
): CommunityDraft[] {
  const exclude = opts?.excludeIds;
  const ranked = posts
    .filter((post) => !isMegathread(post.title))
    .map((post) => {
      const { score, rationale } = scoreRedditPost(post);
      return { post, score, rationale, total: scoreTotal(score) };
    })
    .filter((r) => isActionable(r.score))
    // Best fits first — feed order pins stickies/dailies at the top.
    .sort((a, b) => b.total - a.total);

  const drafts: CommunityDraft[] = [];
  for (const { post, score, rationale } of ranked) {
    const id = `reddit-${post.id}`;
    if (exclude?.has(id)) continue;
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
    if (drafts.length >= limit) break;
  }

  return drafts;
}

/** Stats for scout logs — how deep we looked vs what passed the gate. */
export function scoreListingStats(posts: RedditListingPost[]): ListingScoreStats {
  let actionable = 0;
  let nearMiss = 0;
  let megathreads = 0;
  for (const post of posts) {
    if (isMegathread(post.title)) {
      megathreads += 1;
      continue;
    }
    const { score } = scoreRedditPost(post);
    const total = scoreTotal(score);
    if (total >= 4) actionable += 1;
    else if (total === 3 || HELP_RE.test(`${post.title}\n${post.selftext}`)) {
      nearMiss += 1;
    }
  }
  return { scanned: posts.length, actionable, nearMiss, megathreads };
}

/**
 * Prefer deep-reading posts where the feed snippet is thin but the title
 * looks like a real help ask — that's where shallow scout misses.
 */
export function pickDeepReadCandidates(
  posts: RedditListingPost[],
  max: number,
  opts?: { excludeIds?: ReadonlySet<string> }
): RedditListingPost[] {
  if (max <= 0) return [];
  const exclude = opts?.excludeIds;
  const ranked = posts
    .filter((post) => !isMegathread(post.title))
    .filter((post) => !exclude?.has(`reddit-${post.id}`))
    .map((post) => {
      const { score } = scoreRedditPost(post);
      const total = scoreTotal(score);
      const thinBody = post.selftext.trim().length < 80;
      const helpTitle = HELP_RE.test(post.title);
      let priority = 0;
      if (thinBody && (total >= 3 || helpTitle)) priority = 3;
      else if (thinBody && total >= 2) priority = 2;
      else if (helpTitle) priority = 1;
      return { post, priority, total };
    })
    .filter((r) => r.priority > 0)
    .sort((a, b) => b.priority - a.priority || b.total - a.total);

  const out: RedditListingPost[] = [];
  const seen = new Set<string>();
  for (const r of ranked) {
    if (seen.has(r.post.id)) continue;
    seen.add(r.post.id);
    out.push(r.post);
    if (out.length >= max) break;
  }
  return out;
}
