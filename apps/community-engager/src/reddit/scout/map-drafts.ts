import type {
  CommunityDraft,
  EngageKind,
  OpportunityScore,
  PresenceScore,
} from "../../types.js";
import {
  ACTIONABLE_SCORE_MIN,
  DEFAULT_ENGAGE_KIND,
  EMPTY_OPPORTUNITY_SCORE,
  isActionable,
  isPresenceActionable,
  normalizeEngageKind,
  presenceScoreTotal,
  scoreTotal,
} from "../../types.js";
import {
  DEFAULT_PLAYBOOK,
  shouldScoutMegathread,
  shouldScoutPresence,
  type SubredditPlaybook,
} from "../../policy/playbook.js";
import type { RedditListingPost } from "../client.js";
import { getCommunityConfig } from "../config.js";
import { inferOpMedia } from "../../stages/draft/op-media.js";
import {
  FASHION_PRESENCE_RE,
  HELP_RE,
  isMegathread,
  scorePresencePost,
  scoreRedditPost,
} from "./score.js";

/** Keep OP body small enough for later draft prompts. */
const OP_TEXT_MAX_CHARS = 4000;
const MS_PER_HOUR = 60 * 60 * 1000;
/** Presence near-miss threshold for scout stats (below actionable 4/6). */
const PRESENCE_NEAR_MISS = 2;

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
  /**
   * Drop posts older than this many hours (hard filter).
   * Default: `getCommunityConfig().scout.maxAgeHours` (6).
   * Pass `0` to disable the age filter (tests / research).
   */
  maxAgeHours?: number;
  /** Clock override for age filter (tests). */
  nowMs?: number;
  /**
   * Lane stamped on each skeleton. Default {@link DEFAULT_ENGAGE_KIND}.
   * `presence` uses {@link scorePresencePost}; help uses {@link scoreRedditPost}.
   */
  kind?: EngageKind;
}

function playbookForSub(
  subreddit: string,
  playbookFor?: (subreddit: string) => SubredditPlaybook
): SubredditPlaybook {
  return playbookFor?.(subreddit) ?? DEFAULT_PLAYBOOK;
}

type RankedHelp = {
  lane: "help";
  post: RedditListingPost;
  score: OpportunityScore;
  presenceScore?: undefined;
  rationale: string;
  total: number;
};

type RankedPresence = {
  lane: "presence";
  post: RedditListingPost;
  score: OpportunityScore;
  presenceScore: PresenceScore;
  rationale: string;
  total: number;
};

type Ranked = RankedHelp | RankedPresence;

/** Map scored listing posts into draft skeletons (shared by OAuth + browser scout). */
export function listingPostsToDrafts(
  posts: RedditListingPost[],
  limit: number,
  opts?: ListingPostsToDraftsOptions
): CommunityDraft[] {
  const exclude = opts?.excludeIds;
  const nowMs = opts?.nowMs ?? Date.now();
  const kind = normalizeEngageKind(opts?.kind ?? DEFAULT_ENGAGE_KIND);
  const maxAgeHours =
    opts?.maxAgeHours !== undefined
      ? opts.maxAgeHours
      : getCommunityConfig().scout.maxAgeHours;
  const maxAgeMs =
    maxAgeHours > 0 ? maxAgeHours * MS_PER_HOUR : Number.POSITIVE_INFINITY;
  const maxAgeOpt = Number.isFinite(maxAgeMs) ? maxAgeMs : undefined;

  const ranked: Ranked[] = posts
    .filter((post) => {
      const ageMs = nowMs - post.createdUtc * 1000;
      if (ageMs < 0 || ageMs > maxAgeMs) return false;
      const pb = playbookForSub(post.subreddit, opts?.playbookFor);
      if (kind === "presence" && !shouldScoutPresence(pb)) return false;
      return shouldScoutMegathread(isMegathread(post.title), pb);
    })
    .map((post): Ranked | null => {
      const pb = playbookForSub(post.subreddit, opts?.playbookFor);
      const mega = isMegathread(post.title);
      if (kind === "presence") {
        const { score: presenceScore, rationale } = scorePresencePost(post, {
          playbook: pb,
          maxAgeMs: maxAgeOpt,
        });
        if (!isPresenceActionable(presenceScore)) return null;
        const playbookNote = `playbook presence=${pb.presenceEnabled ? "on" : "off"} plug=${pb.plugStyle}`;
        return {
          lane: "presence",
          post,
          score: EMPTY_OPPORTUNITY_SCORE,
          presenceScore,
          rationale: `${rationale}; ${playbookNote}`,
          total: presenceScoreTotal(presenceScore),
        };
      }

      const { score, rationale } = scoreRedditPost(post, {
        scoreMegathread: mega && pb.megathreadPolicy !== "skip",
        maxAgeMs: maxAgeOpt,
      });
      if (!isActionable(score)) return null;
      const playbookNote =
        mega && pb.megathreadPolicy === "help_only"
          ? "megathread help_only (intensity 0)"
          : `playbook plug=${pb.plugStyle}`;
      return {
        lane: "help",
        post,
        score,
        rationale: `${rationale}; ${playbookNote}`,
        total: scoreTotal(score),
      };
    })
    .filter((r): r is Ranked => r !== null)
    // Best fits first; prefer newer when scores tie.
    .sort(
      (a, b) =>
        b.total - a.total || b.post.createdUtc - a.post.createdUtc
    );

  const drafts: CommunityDraft[] = [];
  for (const row of ranked) {
    const { post, score, rationale } = row;
    const id = `reddit-${post.id}`;
    if (exclude?.has(id)) continue;
    const opText = capOpText(post.selftext);
    const media = inferOpMedia({
      title: post.title,
      opText,
      postUrl: post.url,
      permalink: post.permalink,
      isSelf: post.isSelf,
    });
    const distinctMediaUrl =
      post.url &&
      post.permalink &&
      post.url.replace(/\/+$/, "") !== post.permalink.replace(/\/+$/, "")
        ? post.url
        : undefined;
    drafts.push({
      id,
      platform: "reddit",
      subreddit: post.subreddit,
      threadUrl: post.permalink,
      threadTitle: post.title,
      kind,
      opText,
      ...(media.hint ? { opMediaHint: media.hint } : {}),
      ...(distinctMediaUrl ? { postUrl: distinctMediaUrl } : {}),
      ...(post.imageUrl ? { imageUrl: post.imageUrl } : {}),
      draftText: "",
      // Start help-only; draft stage clamps further via playbook / plugs-week.
      intensity: 0,
      score,
      ...(row.lane === "presence"
        ? { presenceScore: row.presenceScore }
        : {}),
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
  playbookFor?: (subreddit: string) => SubredditPlaybook,
  kind: EngageKind = DEFAULT_ENGAGE_KIND
): ListingScoreStats {
  const lane = normalizeEngageKind(kind);
  let actionable = 0;
  let nearMiss = 0;
  let megathreads = 0;
  for (const post of posts) {
    const pb = playbookForSub(post.subreddit, playbookFor);
    if (isMegathread(post.title)) {
      megathreads += 1;
      if (pb.megathreadPolicy === "skip") continue;
    }
    if (lane === "presence") {
      if (!shouldScoutPresence(pb)) continue;
      const { score } = scorePresencePost(post, { playbook: pb });
      const total = presenceScoreTotal(score);
      if (isPresenceActionable(score)) actionable += 1;
      else if (
        total >= PRESENCE_NEAR_MISS ||
        FASHION_PRESENCE_RE.test(`${post.title}\n${post.selftext}`)
      ) {
        nearMiss += 1;
      }
      continue;
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
    kind?: EngageKind;
  }
): RedditListingPost[] {
  if (max <= 0) return [];
  const exclude = opts?.excludeIds;
  const kind = normalizeEngageKind(opts?.kind ?? DEFAULT_ENGAGE_KIND);
  const ranked = posts
    .filter((post) => {
      const pb = playbookForSub(post.subreddit, opts?.playbookFor);
      if (kind === "presence" && !shouldScoutPresence(pb)) return false;
      return shouldScoutMegathread(isMegathread(post.title), pb);
    })
    .filter((post) => !exclude?.has(`reddit-${post.id}`))
    .map((post) => {
      const pb = playbookForSub(post.subreddit, opts?.playbookFor);
      const mega = isMegathread(post.title);
      const thinBody = post.selftext.trim().length < 80;
      if (kind === "presence") {
        const { score } = scorePresencePost(post, { playbook: pb });
        const total = presenceScoreTotal(score);
        const fashionTitle = FASHION_PRESENCE_RE.test(post.title);
        let priority = 0;
        if (thinBody && (total >= 3 || fashionTitle)) priority = 3;
        else if (thinBody && total >= 2) priority = 2;
        else if (fashionTitle) priority = 1;
        return { post, priority, total };
      }
      const { score } = scoreRedditPost(post, {
        scoreMegathread: mega && pb.megathreadPolicy !== "skip",
      });
      const total = scoreTotal(score);
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
