import { PlaywrightEngine } from "@relay/engines-browser";
import type { CommunityDraft } from "../types.js";
import {
  allowlistedSubNames,
  getRedditEnv,
  type RedditEnvConfig,
} from "./config.js";
import {
  extractListingRowsFromDocument,
  LISTING_READY_SELECTOR,
  listingUrl,
  rowsToListingPosts,
} from "./extract-listing.js";
import { listingPostsToDrafts } from "./map-drafts.js";

export interface BrowserScoutOptions {
  limit?: number;
  subreddits?: string[];
  cfg?: RedditEnvConfig;
  /** Delay between subreddit navigations (ms). */
  delayMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Default UA when env still has the placeholder bot string — www.reddit is
 * friendlier to a normal Chrome UA for anonymous listing.
 */
function browserUserAgent(cfg: RedditEnvConfig): string {
  const ua = cfg.userAgent;
  if (!ua || /relay-community-engager/i.test(ua)) {
    return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
  }
  return ua;
}

/**
 * Read-only Reddit scout via Playwright + structured extract (shreddit-post attrs).
 * No OAuth app required. Refuses low scores (< 4/5). Never writes.
 */
export async function scoutRedditBrowser(
  opts: BrowserScoutOptions = {}
): Promise<CommunityDraft[]> {
  const cfg = opts.cfg ?? getRedditEnv();
  const subs = opts.subreddits?.length ? opts.subreddits : allowlistedSubNames();
  const limit = opts.limit ?? 5;
  const delayMs = opts.delayMs ?? cfg.scoutDelayMs;
  const drafts: CommunityDraft[] = [];

  const engine = new PlaywrightEngine({
    headless: cfg.browserHeadless,
    userAgent: browserUserAgent(cfg),
  });

  try {
    const page = await engine.getPage();

    for (let i = 0; i < subs.length; i++) {
      const sub = subs[i]!;
      const url = listingUrl(sub, "new");
      console.log(`[scout:browser] r/${sub} → ${url}`);

      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await page.waitForSelector(LISTING_READY_SELECTOR, { timeout: 30_000 });

        const rows = await page.evaluate(extractListingRowsFromDocument);
        const posts = rowsToListingPosts(rows, sub);
        console.log(`[scout:browser] r/${sub} extracted ${posts.length} posts`);

        const mapped = listingPostsToDrafts(posts, limit - drafts.length);
        drafts.push(...mapped);

        if (drafts.length >= limit) {
          return drafts;
        }
      } catch (err) {
        console.warn(`[scout:browser] r/${sub} failed:`, err);
      }

      if (i < subs.length - 1 && delayMs > 0) {
        await sleep(delayMs);
      }
    }
  } finally {
    await engine.teardown();
  }

  return drafts;
}
