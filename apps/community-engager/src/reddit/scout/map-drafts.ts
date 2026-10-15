import type { CommunityDraft } from "../../types.js";
import {
  ACTIONABLE_SCORE_MIN,
  isActionable,
  scoreTotal,
} from "../../types.js";
import {
  DEFAULT_PLAYBOOK,
  shouldScoutMegathread,
  type SubredditPlaybook,
} from "../../policy/playbook.js";
import type { RedditListingPost } from "../client.js";
import { inferOpMedia } from "../../stages/draft/op-media.js";
import { HELP_RE, isMegathread, scoreRedditPost } from "./score.js";

/** Keep OP body small enough for later draft prompts. */
const OP_TEXT_MAX_CHARS = 4000;

function capOpText(selftext: string): string {
  const trimmed = selftext.trim();
  if (trimmed.length <= OP_TEXT_MAX_CHARS) return trimmed;
  return trimmed.slice(0, OP_TEXT_MAX_CHARS);
}

export interface ListingScoreStats {
  scanned: number;
  actionable: number;
  nearMiss: number;
  megathreads: number;
}

export interface ListingPostsToDraftsOptions {
  excludeIds?: ReadonlySet<string>;
  /** Resolve playbook per sub (lowercase name). Defaults to DEFAULT_PLAYBOOK. */
  playbookFor?: (subreddit: string) => SubredditPlaybook;
}

function playbookForSub(
  subreddit: string,
  playbookFor?: (subreddit: string) => SubredditPlaybook
): SubredditPlaybook {
  return playbookFor?.(subreddit) ?? DEFAULT_PLAYBOOK;
}

/** Map scored listing posts into draft skeletons (shared by OAuth + browser scout). */
export function listingPostsToDrafts(
  posts: RedditListingPost[],
  limit: number,
  opts?: ListingPostsToDraftsOptions
): CommunityDraft[] {
  const exclude = opts?.excludeIds;
  const ranked = posts
    .filter((post) => {
      const pb = playbookForSub(post.subreddit, opts?.playbookFor);
      return shouldScoutMegathread(isMegathread(post.title), pb);
    })
    .map((post) => {
      const pb = playbookForSub(post.subreddit, opts?.playbookFor);
      const mega = isMegathread(post.title);
      const { score, rationale } = scoreRedditPost(post, {
        scoreMegathread: mega && pb.megathreadPolicy !== "skip",
      });
      const playbookNote =
        mega && pb.megathreadPolicy === "help_only"
          ? "megathread help_only (intensity 0)"
          : `playbook plug=${pb.plugStyle}`;
      return {
        post,
        score,
        rationale: `${rationale}; ${playbookNote}`,
        total: scoreTotal(score),
        mega,
        playbook: pb,
      };
    })
    .filter((r) => isActionable(r.score))
    // Best fits first — feed order pins stickies/dailies at the top.
    .sort((a, b) => b.total - a.total);

  const drafts: CommunityDraft[] = [];
  for (const { post, score, rationale } of ranked) {
    const id = `reddit-${post.id}`;
    if (exclude?.has(id)) continue;
    const opText = capOpText(post.selftext);
    const media = inferOpMedia({
      title: post.title,
      opText,
      postUrl: post.url,
    });
    drafts.push({
      id,
      platform: "reddit",
      subreddit: post.subreddit,
      threadUrl: post.permalink,
      threadTitle: post.title,
      opText,
      ...(media.hint ? { opMediaHint: media.hint } : {}),
      ...(post.url && post.url !== post.permalink
        ? { postUrl: post.url }
        : {}),
      draftText: "",
      // Start help-only; draft stage clamps further via playbook / plugs-week.
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
export function scoreListingStats(
  posts: RedditListingPost[],
  playbookFor?: (subreddit: string) => SubredditPlaybook
): ListingScoreStats {
  let actionable = 0;
  let nearMiss = 0;
  let megathreads = 0;
  for (const post of posts) {
    const pb = playbookForSub(post.subreddit, playbookFor);
    if (isMegathread(post.title)) {
      megathreads += 1;
      if (pb.megathreadPolicy === "skip") continue;
    }
    const mega = isMegathread(post.title);
    const { score } = scoreRedditPost(post, {
      scoreMegathread: mega && pb.megathreadPolicy !== "skip",
    });
    const total = scoreTotal(score);
    if (total >= ACTIONABLE_SCORE_MIN) actionable += 1;
    else if (
      total >= ACTIONABLE_SCORE_MIN - 2 ||
      HELP_RE.test(`${post.title}\n${post.selftext}`)
    ) {
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
  opts?: {
    excludeIds?: ReadonlySet<string>;
    playbookFor?: (subreddit: string) => SubredditPlaybook;
  }
): RedditListingPost[] {
  if (max <= 0) return [];
  const exclude = opts?.excludeIds;
  const ranked = posts
    .filter((post) => {
      const pb = playbookForSub(post.subreddit, opts?.playbookFor);
      return shouldScoutMegathread(isMegathread(post.title), pb);
    })
    .filter((post) => !exclude?.has(`reddit-${post.id}`))
    .map((post) => {
      const pb = playbookForSub(post.subreddit, opts?.playbookFor);
      const mega = isMegathread(post.title);
      const { score } = scoreRedditPost(post, {
        scoreMegathread: mega && pb.megathreadPolicy !== "skip",
      });
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
