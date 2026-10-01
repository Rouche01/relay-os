import type { CommunityDraft } from "../types.js";
import { isActionable } from "../types.js";
import type { RedditListingPost } from "./client.js";
import { scoreRedditPost } from "./score.js";

/** Map scored listing posts into draft skeletons (shared by OAuth + browser scout). */
export function listingPostsToDrafts(
  posts: RedditListingPost[],
  limit: number
): CommunityDraft[] {
  const drafts: CommunityDraft[] = [];

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

    if (drafts.length >= limit) break;
  }

  return drafts;
}
