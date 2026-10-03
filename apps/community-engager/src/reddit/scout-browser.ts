import type { Page } from "playwright";
import type { CommunityDraft } from "../types.js";
import type { RedditListingPost } from "./client.js";
import {
  allowlistedSubNames,
  getRedditEnv,
  type RedditEnvConfig,
} from "./config.js";
import { createRedditBrowserEngine } from "./browser-session.js";
import {
  extractListingRowsFromDocument,
  extractPostBodyFromDocument,
  LISTING_READY_SELECTOR,
  listingUrl,
  rowsToListingPosts,
} from "./extract-listing.js";
import {
  detectInterstitial,
  isRateLimit,
  type InterstitialDetection,
} from "./interstitial.js";
import {
  listingPostsToDrafts,
  pickDeepReadCandidates,
  scoreListingStats,
} from "./map-drafts.js";

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
  /** Base delay between subreddit navigations (ms). */
  delayMs?: number;
  /** Load cookie jar if present (default true). */
  useStoredSession?: boolean;
  /** Total time budget per sub (default cfg.scoutSubBudgetMs). */
  subBudgetMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pacedDelay(baseMs: number, jitterMs: number): number {
  if (baseMs <= 0) return 0;
  const jitter =
    jitterMs > 0 ? Math.floor(Math.random() * (jitterMs + 1)) : 0;
  return baseMs + jitter;
}

async function scrollFeed(
  page: Page,
  rounds: number,
  pauseBaseMs: number,
  pauseJitterMs: number
): Promise<number> {
  let count = await page.locator(LISTING_READY_SELECTOR).count();
  for (let r = 0; r < rounds; r++) {
    await page.evaluate(() => {
      window.scrollBy(0, Math.floor(window.innerHeight * 0.85));
    });
    await sleep(pacedDelay(pauseBaseMs, pauseJitterMs));
    const next = await page.locator(LISTING_READY_SELECTOR).count();
    if (next <= count && r > 0) break;
    count = next;
  }
  // Ease back toward top so extract sees a stable DOM.
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(400);
  return count;
}

async function deepReadPosts(
  page: Page,
  candidates: RedditListingPost[],
  byId: Map<string, RedditListingPost>,
  pauseBaseMs: number,
  pauseJitterMs: number
): Promise<number> {
  let enriched = 0;
  for (const candidate of candidates) {
    const url = candidate.permalink;
    console.log(`[scout:browser] deep-read → ${candidate.title.slice(0, 60)}…`);
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 12_000,
      });
      await sleep(pacedDelay(pauseBaseMs, pauseJitterMs));

      const wall = await detectInterstitial(page);
      if (wall.challenged) {
        console.warn(
          `[scout:browser] deep-read blocked (${wall.reason}) — aborting further deep-reads`
        );
        if (isRateLimit(wall)) throw Object.assign(new Error("rate_limit"), { wall });
        break;
      }

      const body = await page.evaluate(extractPostBodyFromDocument);
      const existing = byId.get(candidate.id);
      if (existing && body.selftext && body.selftext.length > existing.selftext.length) {
        existing.selftext = body.selftext;
        if (body.title) existing.title = body.title;
        enriched += 1;
      }
    } catch (err) {
      if (err && typeof err === "object" && "wall" in err) throw err;
      console.warn(`[scout:browser] deep-read failed for ${candidate.id}:`, err);
    }
  }
  return enriched;
}

/**
 * Read-only Reddit scout via Playwright + structured extract.
 * Per sub: open /new → scroll to load more → score feed → deep-read thin
 * but promising threads for full OP text. Paced like a human browser.
 */
export async function scoutRedditBrowser(
  opts: BrowserScoutOptions = {}
): Promise<BrowserScoutResult> {
  const cfg = opts.cfg ?? getRedditEnv();
  let subs = opts.subreddits?.length ? opts.subreddits : allowlistedSubNames();
  if (cfg.scoutMaxSubs > 0) {
    subs = subs.slice(0, cfg.scoutMaxSubs);
  }
  const limit = opts.limit ?? 5;
  const delayMs = opts.delayMs ?? cfg.scoutDelayMs;
  const jitterMs = cfg.scoutDelayJitterMs;
  const subBudgetMs = opts.subBudgetMs ?? cfg.scoutSubBudgetMs;
  const scrollRounds = cfg.scoutScrollRounds;
  const deepReadMax = cfg.scoutDeepReadMax;
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
  console.log(
    `[scout:browser] pacing base=${delayMs}ms jitter=0…${jitterMs}ms ` +
      `subs=${subs.length} scroll=${scrollRounds} deepRead≤${deepReadMax}`
  );

  try {
    const page = await engine.getPage();
    const gotoTimeout = Math.min(12_000, subBudgetMs);

    try {
      await page.goto("https://www.reddit.com/", {
        waitUntil: "domcontentloaded",
        timeout: gotoTimeout,
      });
      await sleep(pacedDelay(Math.min(delayMs, 3000), Math.min(jitterMs, 2000)));
    } catch (err) {
      console.warn("[scout:browser] warm-up navigation failed:", err);
    }

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
        await sleep(pacedDelay(1000, 1500));

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
          if (isRateLimit(wall)) {
            console.warn(
              "[scout:browser] rate-limited — stopping scout (wait several minutes before retry)"
            );
            break;
          }
          continue;
        }

        const remaining = Math.max(
          3_000,
          subBudgetMs - (Date.now() - started)
        );
        try {
          await page.waitForSelector(LISTING_READY_SELECTOR, {
            timeout: Math.min(remaining, 15_000),
          });
        } catch {
          const again = await detectInterstitial(page);
          if (again.challenged) {
            blocked.push({
              subreddit: sub,
              url,
              reason: again.reason ?? "interstitial",
            });
            if (isRateLimit(again)) {
              console.warn(
                "[scout:browser] rate-limited — stopping scout (wait several minutes before retry)"
              );
              break;
            }
          } else {
            console.warn(
              `[scout:browser] r/${sub} timed out waiting for listing`
            );
            timedOut.push(sub);
          }
          continue;
        }

        // Browse the feed — load more cards instead of one viewport.
        const loaded = await scrollFeed(
          page,
          scrollRounds,
          Math.min(delayMs, 2500),
          Math.min(jitterMs, 1500)
        );
        console.log(`[scout:browser] r/${sub} feed cards≈${loaded} after scroll`);

        let rows = await page.evaluate(extractListingRowsFromDocument);
        let posts = rowsToListingPosts(rows, sub);
        const byId = new Map(posts.map((p) => [p.id, p]));

        const candidates = pickDeepReadCandidates(posts, deepReadMax);
        if (candidates.length > 0) {
          try {
            const n = await deepReadPosts(
              page,
              candidates,
              byId,
              Math.min(delayMs, 2000),
              Math.min(jitterMs, 1500)
            );
            console.log(
              `[scout:browser] r/${sub} deep-read enriched ${n}/${candidates.length}`
            );
            // Return to listing context isn't required — we hold posts in memory.
            posts = [...byId.values()];
          } catch (err) {
            const wall =
              err && typeof err === "object" && "wall" in err
                ? ((err as { wall: InterstitialDetection }).wall)
                : undefined;
            if (wall && isRateLimit(wall)) {
              blocked.push({
                subreddit: sub,
                url,
                reason: "rate_limit",
              });
              console.warn(
                "[scout:browser] rate-limited during deep-read — stopping scout"
              );
              // Still keep whatever we already scored from the feed.
            } else {
              console.warn(`[scout:browser] r/${sub} deep-read batch error:`, err);
            }
          }
        }

        const stats = scoreListingStats(posts);
        console.log(
          `[scout:browser] r/${sub} scanned=${stats.scanned} actionable=${stats.actionable} nearMiss=${stats.nearMiss}`
        );

        const mapped = listingPostsToDrafts(posts, limit - drafts.length);
        drafts.push(...mapped);

        if (
          blocked.some((b) => b.subreddit === sub && b.reason === "rate_limit")
        ) {
          break;
        }

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
          if (isRateLimit(wall)) {
            console.warn(
              "[scout:browser] rate-limited — stopping scout (wait several minutes before retry)"
            );
            break;
          }
        } else {
          console.warn(`[scout:browser] r/${sub} failed:`, err);
          timedOut.push(sub);
        }
      }

      if (i < subs.length - 1) {
        const wait = pacedDelay(delayMs, jitterMs);
        if (wait > 0) {
          console.log(
            `[scout:browser] waiting ${(wait / 1000).toFixed(1)}s before next sub…`
          );
          await sleep(wait);
        }
      }
    }
  } finally {
    await engine.teardown();
  }

  return { drafts, blocked, timedOut };
}
