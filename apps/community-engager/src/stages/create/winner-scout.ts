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

const DEFAULT_MIN_SCORE = 50;
const DEFAULT_MIN_COMMENTS = 8;
const DEFAULT_MIN_SOURCE_AGE_DAYS = 3;

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

/**
 * Scout remodeled-winner sources: top/week then hot on create-enabled subs.
 */
export async function scoutWinners(
  opts: WinnerScoutOptions = {}
): Promise<WinnerCandidate[]> {
  const cfg = opts.cfg ?? getCommunityConfig();
  const limit = Math.max(1, opts.limit ?? 2);
  const minAgeDays = DEFAULT_MIN_SOURCE_AGE_DAYS;
  const minAgeSec = minAgeDays * 86_400;
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
      .filter((p) => {
        if (!p.title?.trim()) return false;
        if ((p.numComments ?? 0) < DEFAULT_MIN_COMMENTS) return false;
        // Prefer aged posts (proven engagement); skip brand-new hot.
        const age = nowSec - (p.createdUtc || 0);
        if (p.createdUtc > 0 && age < minAgeSec) return false;
        // Megathread stickies rarely make good remodel seeds.
        if (/daily|weekly|megathread|waywt|simple questions/i.test(p.title)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => (b.numComments ?? 0) - (a.numComments ?? 0));

    for (const post of filtered) {
      winners.push({ post, subreddit: name, playbook });
      if (winners.length >= limit) return winners;
    }
  }

  // Soften age filter if nothing aged enough (still require comments).
  if (winners.length === 0) {
    for (const { name, playbook } of subs) {
      try {
        const posts = await listPosts(name, "hot");
        for (const post of posts) {
          if (!post.title?.trim()) continue;
          if ((post.numComments ?? 0) < DEFAULT_MIN_COMMENTS) continue;
          if (/daily|weekly|megathread|waywt|simple questions/i.test(post.title)) {
            continue;
          }
          winners.push({ post, subreddit: name, playbook });
          if (winners.length >= limit) return winners;
        }
      } catch {
        /* already logged above path */
      }
    }
  }

  void DEFAULT_MIN_SCORE; // reserved for score-gated transports later
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
