import type { CommunityDraft } from "../types.js";
import {
  allowlistedSubNames,
  getRedditEnv,
  type RedditEnvConfig,
} from "./config.js";
import { createRedditBrowserEngine } from "./browser-session.js";
import {
  extractListingRowsFromDocument,
  LISTING_READY_SELECTOR,
  listingUrl,
  rowsToListingPosts,
} from "./extract-listing.js";
import { detectInterstitial } from "./interstitial.js";
import { listingPostsToDrafts } from "./map-drafts.js";

export interface BrowserScoutBlocked {
  subreddit: string;
  url: string;
  reason: string;
}

export interface BrowserScoutResult {
  drafts: CommunityDraft[];
  blocked: BrowserScoutBlocked[];
  timedOut: string[];
}

export interface BrowserScoutOptions {
  limit?: number;
  subreddits?: string[];
  cfg?: RedditEnvConfig;
  /** Delay between subreddit navigations (ms). */
  delayMs?: number;
  /** Load cookie jar if present (default true). */
  useStoredSession?: boolean;
  /** Total time budget per sub (default cfg.scoutSubBudgetMs / 12s). */
  subBudgetMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Read-only Reddit scout via Playwright + structured extract.
 * Detects anti-bot interstitials in ~seconds (no CAPTCHA solving).
 * Restores cookie jar when available (AUTHED browse).
 */
export async function scoutRedditBrowser(
  opts: BrowserScoutOptions = {}
): Promise<BrowserScoutResult> {
  const cfg = opts.cfg ?? getRedditEnv();
  const subs = opts.subreddits?.length ? opts.subreddits : allowlistedSubNames();
  const limit = opts.limit ?? 5;
  const delayMs = opts.delayMs ?? cfg.scoutDelayMs;
  const subBudgetMs = opts.subBudgetMs ?? cfg.scoutSubBudgetMs;
  const drafts: CommunityDraft[] = [];
  const blocked: BrowserScoutBlocked[] = [];
  const timedOut: string[] = [];

  const { engine, sessionLoaded } = await createRedditBrowserEngine({
    cfg,
    useStoredSession: opts.useStoredSession ?? true,
  });
  if (sessionLoaded) {
    console.log("[scout:browser] using stored Reddit session");
  }

  try {
    const page = await engine.getPage();
    const gotoTimeout = Math.min(8_000, subBudgetMs);

    for (let i = 0; i < subs.length; i++) {
      const sub = subs[i]!;
      const url = listingUrl(sub, "new");
      console.log(`[scout:browser] r/${sub} → ${url}`);
      const started = Date.now();

      try {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: gotoTimeout,
        });

        const wall = await detectInterstitial(page);
        if (wall.challenged) {
          console.warn(
            `[scout:browser] r/${sub} blocked (${wall.reason ?? "interstitial"}) — ${wall.title ?? url}`
          );
          blocked.push({
            subreddit: sub,
            url,
            reason: wall.reason ?? "interstitial",
          });
          continue;
        }

        const remaining = Math.max(
          2_000,
          subBudgetMs - (Date.now() - started)
        );
        try {
          await page.waitForSelector(LISTING_READY_SELECTOR, {
            timeout: remaining,
          });
        } catch {
          const again = await detectInterstitial(page);
          if (again.challenged) {
            console.warn(
              `[scout:browser] r/${sub} blocked after wait (${again.reason})`
            );
            blocked.push({
              subreddit: sub,
              url,
              reason: again.reason ?? "interstitial",
            });
          } else {
            console.warn(
              `[scout:browser] r/${sub} timed out waiting for listing (~${subBudgetMs}ms)`
            );
            timedOut.push(sub);
          }
          continue;
        }

        const rows = await page.evaluate(extractListingRowsFromDocument);
        const posts = rowsToListingPosts(rows, sub);
        console.log(`[scout:browser] r/${sub} extracted ${posts.length} posts`);

        const mapped = listingPostsToDrafts(posts, limit - drafts.length);
        drafts.push(...mapped);

        if (drafts.length >= limit) {
          return { drafts, blocked, timedOut };
        }
      } catch (err) {
        const wall = await detectInterstitial(page).catch(() => ({
          challenged: false as const,
        }));
        if (wall.challenged) {
          blocked.push({
            subreddit: sub,
            url,
            reason: wall.reason ?? "interstitial",
          });
        } else {
          console.warn(`[scout:browser] r/${sub} failed:`, err);
          timedOut.push(sub);
        }
      }

      if (i < subs.length - 1 && delayMs > 0) {
        await sleep(delayMs);
      }
    }
  } finally {
    await engine.teardown();
  }

  return { drafts, blocked, timedOut };
}
