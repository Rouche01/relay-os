import {
  getAllowlistStore,
  resolvePlaybook,
} from "../../policy/allowlist-store.js";
import type { SubredditPlaybook } from "../../policy/playbook.js";
import type { PromoLedgerEntry } from "../../policy/promo-ratio.js";
import { readPromoLedger } from "../../policy/promo-ratio.js";
import {
  getCommunityConfig,
  type CommunityRuntimeConfig,
} from "../../reddit/config.js";
import type { RedditListingPost } from "../../reddit/client.js";
import { RedditApisClient } from "../../reddit/redditapis/client.js";
import { fetchJsonListing } from "../../reddit/scout/scout-json.js";
import { normalizeEngageKind } from "../../types.js";

export interface WinnerCandidate {
  post: RedditListingPost;
  subreddit: string;
  playbook: SubredditPlaybook;
}

export interface WinnerScoutOptions {
  cfg?: CommunityRuntimeConfig;
  /** Max winners to return (default 2). */
  limit?: number;
  /** Prefer these subs (tests). */
  subreddits?: string[];
  nowMs?: number;
  /** Inject listing fetch (tests). */
  listPosts?: (
    sub: string,
    sort: "top" | "hot"
  ) => Promise<RedditListingPost[]>;
}

/** Min Reddit score (upvotes) when the listing transport provides `score`. */
export const CREATE_WINNER_MIN_SCORE = 50;
/** Min top-level-ish comments for remodel seeds. */
export const CREATE_WINNER_MIN_COMMENTS = 8;
/** Prefer sources at least this old (days) before remodel. */
export const CREATE_WINNER_MIN_AGE_DAYS = 3;

/** @deprecated Use {@link CREATE_WINNER_MIN_SCORE}. */
const DEFAULT_MIN_SCORE = CREATE_WINNER_MIN_SCORE;
/** @deprecated Use {@link CREATE_WINNER_MIN_COMMENTS}. */
const DEFAULT_MIN_COMMENTS = CREATE_WINNER_MIN_COMMENTS;
/** @deprecated Use {@link CREATE_WINNER_MIN_AGE_DAYS}. */
const DEFAULT_MIN_SOURCE_AGE_DAYS = CREATE_WINNER_MIN_AGE_DAYS;

/**
 * Pick allowlisted subs with `allowsOriginalPosts` and create cooldown clear.
 */
export async function pickCreateSubs(
  opts: WinnerScoutOptions = {}
): Promise<Array<{ name: string; playbook: SubredditPlaybook }>> {
  const cfg = opts.cfg ?? getCommunityConfig();
  const store = getAllowlistStore();
  const nowMs = opts.nowMs ?? Date.now();
  const ledger = await readPromoLedger(cfg.reddit.dataDir);
  const names =
    opts.subreddits?.map((s) => s.replace(/^r\//i, "").trim()).filter(Boolean) ??
    (await store.listPostable()).map((e) => e.name);

  const out: Array<{ name: string; playbook: SubredditPlaybook }> = [];
  for (const name of names) {
    const entry = await store.get(name);
    const playbook = resolvePlaybook(entry ?? name);
    if (!playbook.allowsOriginalPosts) continue;
    if (createCooldownActive(ledger.entries, name, playbook.createCooldownDays, nowMs)) {
      continue;
    }
    out.push({ name, playbook });
  }
  return out;
}

export function createCooldownActive(
  entries: ReadonlyArray<Pick<PromoLedgerEntry, "postedAt" | "kind" | "subreddit">>,
  subreddit: string,
  cooldownDays: number,
  nowMs = Date.now()
): boolean {
  const sub = subreddit.replace(/^r\//i, "").trim().toLowerCase();
  const windowMs = Math.max(0, cooldownDays) * 86_400_000;
  if (windowMs <= 0) return false;
  for (const e of entries) {
    if (normalizeEngageKind(e.kind) !== "create") continue;
    const eSub = (e.subreddit ?? "").replace(/^r\//i, "").trim().toLowerCase();
    if (eSub !== sub) continue;
    const t = Date.parse(e.postedAt);
    if (!Number.isFinite(t)) continue;
    if (nowMs - t < windowMs) return true;
  }
  return false;
}

export type WinnerGateOpts = {
  nowSec?: number;
  minComments?: number;
  minScore?: number;
  minAgeDays?: number;
  /** When true, skip the min-age check (hot fallback path). */
  skipAge?: boolean;
};

/**
 * Create winner filters: title, comments, optional score, age, megathread ban.
 * Unknown `score` does not fail the gate (browser listings); known score must clear min.
 */
export function passesWinnerGates(
  post: RedditListingPost,
  opts: WinnerGateOpts = {}
): boolean {
  if (!post.title?.trim()) return false;
  const minComments = opts.minComments ?? DEFAULT_MIN_COMMENTS;
  if ((post.numComments ?? 0) < minComments) return false;

  const minScore = opts.minScore ?? DEFAULT_MIN_SCORE;
  if (
    typeof post.score === "number" &&
    Number.isFinite(post.score) &&
    post.score < minScore
  ) {
    return false;
  }

  if (!opts.skipAge) {
    const minAgeDays = opts.minAgeDays ?? DEFAULT_MIN_SOURCE_AGE_DAYS;
    const minAgeSec = minAgeDays * 86_400;
    const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
    const age = nowSec - (post.createdUtc || 0);
    if (post.createdUtc > 0 && age < minAgeSec) return false;
  }

  if (/daily|weekly|megathread|waywt|simple questions/i.test(post.title)) {
    return false;
  }
  return true;
}

function rankWinners(a: RedditListingPost, b: RedditListingPost): number {
  const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
  if (scoreDiff !== 0) return scoreDiff;
  return (b.numComments ?? 0) - (a.numComments ?? 0);
}

/**
 * Scout remodeled-winner sources: top/week then hot on create-enabled subs.
 */
export async function scoutWinners(
  opts: WinnerScoutOptions = {}
): Promise<WinnerCandidate[]> {
  const cfg = opts.cfg ?? getCommunityConfig();
  const limit = Math.max(1, opts.limit ?? 2);
  const nowSec = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  const subs = await pickCreateSubs(opts);
  if (subs.length === 0) {
    console.warn(
      "[create] no allowlisted subs with allowsOriginalPosts + cooldown clear"
    );
    return [];
  }

  const listPosts =
    opts.listPosts ??
    ((sub: string, sort: "top" | "hot") => defaultListPosts(cfg, sub, sort));

  const winners: WinnerCandidate[] = [];
  for (const { name, playbook } of subs) {
    let posts: RedditListingPost[] = [];
    try {
      posts = await listPosts(name, "top");
      if (posts.length < 3) {
        const hot = await listPosts(name, "hot");
        posts = [...posts, ...hot];
      }
    } catch (err) {
      console.warn(`[create] winner scout r/${name} failed:`, err);
      continue;
    }

    const filtered = posts
      .filter((p) => passesWinnerGates(p, { nowSec }))
      .sort(rankWinners);

    for (const post of filtered) {
      winners.push({ post, subreddit: name, playbook });
      if (winners.length >= limit) return winners;
    }
  }

  // Soften age filter if nothing aged enough (still require comments + score).
  if (winners.length === 0) {
    for (const { name, playbook } of subs) {
      try {
        const posts = await listPosts(name, "hot");
        const filtered = posts
          .filter((post) => passesWinnerGates(post, { nowSec, skipAge: true }))
          .sort(rankWinners);
        for (const post of filtered) {
          winners.push({ post, subreddit: name, playbook });
          if (winners.length >= limit) return winners;
        }
      } catch {
        /* already logged above path */
      }
    }
  }

  return winners.slice(0, limit);
}

async function defaultListPosts(
  cfg: CommunityRuntimeConfig,
  sub: string,
  sort: "top" | "hot"
): Promise<RedditListingPost[]> {
  if (cfg.redditApis.configured) {
    const client = new RedditApisClient(cfg.redditApis);
    return client.listNew(sub, 25, { sort });
  }
  return fetchJsonListing(sub, sort === "top" ? "top" : "hot");
}
