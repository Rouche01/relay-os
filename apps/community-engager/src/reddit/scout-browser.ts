import type { Page } from "playwright";
import type { DecisionPort } from "@relay/engines-decide";
import { createDecisionPort } from "@relay/engines-decide";
import type { PlaywrightEngine } from "@relay/engines-browser";
import { detectInterstitialDecided } from "../interstitial-decide.js";
import type { CommunityDraft } from "../types.js";
import { scoreTotal } from "../types.js";
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
  isRateLimit,
  type InterstitialDetection,
} from "./interstitial.js";
import {
  listingPostsToDrafts,
  pickDeepReadCandidates,
  scoreListingStats,
} from "./map-drafts.js";

/** Page-class decide → InterstitialDetection (escalates low confidence to HITL). */
async function classifyScoutPage(
  page: Page,
  decide: DecisionPort
): Promise<InterstitialDetection> {
  const decided = await detectInterstitialDecided(page, { decide });
  const conf = decided.confidence.toFixed(2);
  if (decided.escalateHitl) {
    console.warn(
      `[scout:browser] page-class escalate class=${decided.pageClass} conf=${conf} backend=${decided.backend}`
    );
  } else {
    console.log(
      `[scout:browser] page-class=${decided.pageClass} conf=${conf} backend=${decided.backend}`
    );
  }
  return decided.detection;
}

export interface BrowserScoutBlocked {
  subreddit: string;
  url: string;
  reason: string;
}

/** Headed (or current) browser left open on a CAPTCHA for HITL. */
export interface ScoutChallengeHandOff {
  engine: PlaywrightEngine;
  storagePath: string;
  url: string;
  subreddit: string;
  reason: string;
  title?: string;
}

export interface BrowserScoutSubOutcome {
  subreddit: string;
  status: "ok" | "blocked" | "timed_out" | "error";
  reason?: string;
  opportunities: number;
  url?: string;
}

export interface BrowserScoutResult {
  drafts: CommunityDraft[];
  blocked: BrowserScoutBlocked[];
  timedOut: string[];
  /** Per-sub visit outcomes (order of attempt). */
  subOutcomes: BrowserScoutSubOutcome[];
  /** Planned allowlist slice for this scout pass. */
  plannedSubs: string[];
  /** When set, engine was NOT torn down — controller owns HITL teardown. */
  challenge?: ScoutChallengeHandOff;
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
  /**
   * On CAPTCHA/humanity wall, stop and hand off the live browser for HITL
   * (default: cfg.interstitialHitl).
   */
  escalateCaptcha?: boolean;
  /** Page-class DecisionPort (default createDecisionPort). */
  decide?: DecisionPort;
  /**
   * Draft ids (`reddit-<id>`) already in the action-store — skipped so `limit`
   * is counted in fresh opportunities for this run.
   */
  excludeIds?: Iterable<string>;
  /**
   * Continue in an already-authenticated headed browser (post-login HITL).
   * Caller owns teardown unless a new challenge is handed off.
   */
  adopt?: { engine: PlaywrightEngine; storagePath: string };
  /**
   * Subs we already attempted login HITL for this run — on login_wall again,
   * skip and continue (do not re-open credential prompt).
   */
  skipLoginHitlSubs?: string[];
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
  pauseJitterMs: number,
  decide: DecisionPort
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

      const wall = await classifyScoutPage(page, decide);
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
  const escalateCaptcha = opts.escalateCaptcha ?? cfg.interstitialHitl;
  const decide = opts.decide ?? createDecisionPort();
  const drafts: CommunityDraft[] = [];
  const blocked: BrowserScoutBlocked[] = [];
  const timedOut: string[] = [];
  const subOutcomes: BrowserScoutSubOutcome[] = [];
  const excludeIds = new Set(opts.excludeIds ?? []);
  const plannedSubs = [...subs];

  // Fair share of *new* drafts per sub; `limit` is the run target after excludes.
  const perSubCap = Math.max(1, Math.ceil(limit / Math.max(1, subs.length)));
  const skipLoginHitl = new Set(
    (opts.skipLoginHitlSubs ?? []).map((s) => s.replace(/^r\//i, "").toLowerCase())
  );

  let engine: PlaywrightEngine;
  let storagePath: string;
  let adopted = false;

  if (opts.adopt) {
    engine = opts.adopt.engine;
    storagePath = opts.adopt.storagePath;
    adopted = true;
    console.log(
      "[scout:browser] continuing in existing headed browser (post-login)"
    );
  } else {
    const created = await createRedditBrowserEngine({
      cfg,
      useStoredSession: opts.useStoredSession ?? true,
    });
    engine = created.engine;
    storagePath = created.storagePath;
    if (created.sessionLoaded) {
      console.log("[scout:browser] using stored Reddit session");
    }
  }
  console.log(
    `[scout:browser] pacing base=${delayMs}ms jitter=0…${jitterMs}ms ` +
      `subs=${subs.length} scroll=${scrollRounds} deepRead≤${deepReadMax} ` +
      `perSub≤${perSubCap} limit=${limit} exclude=${excludeIds.size}` +
      (skipLoginHitl.size ? ` skipLogin=${[...skipLoginHitl].join(",")}` : "")
  );

  let challenge: ScoutChallengeHandOff | undefined;
  /** When true, finally must not teardown — HITL owns the window. */
  let handOffEngine = false;

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

    const handOffCaptcha = (
      sub: string,
      url: string,
      wall: InterstitialDetection
    ): boolean => {
      if (isRateLimit(wall) || !escalateCaptcha) return false;
      if (skipLoginHitl.has(sub.toLowerCase())) return false;
      challenge = {
        engine,
        storagePath,
        url: page.url() || url,
        subreddit: sub,
        reason: wall.reason ?? "interstitial",
        title: wall.title,
      };
      handOffEngine = true;
      console.log(
        `[scout:browser] challenge HITL — keeping browser open on r/${sub}; ` +
          `auto-detects clear (or Approve in Telegram/CLI)`
      );
      return true;
    };

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

        let wall = await classifyScoutPage(page, decide);
        // Soft confirm: flaky captcha chrome on a ready listing is not a wall.
        if (wall.challenged && wall.reason === "captcha_widget") {
          const listingReady = await page
            .$(LISTING_READY_SELECTOR)
            .catch(() => null);
          if (listingReady) {
            console.log(
              `[scout:browser] r/${sub} ignoring captcha_widget chrome — listing ready`
            );
            wall = { challenged: false, title: wall.title };
          }
        }
        if (wall.challenged) {
          const alreadyTriedHitl = skipLoginHitl.has(sub.toLowerCase());
          console.warn(
            `[scout:browser] r/${sub} blocked (${wall.reason ?? "interstitial"}) — ${wall.title ?? url}`
          );
          const reason = alreadyTriedHitl
            ? "skipped_after_hitl"
            : (wall.reason ?? "interstitial");
          blocked.push({ subreddit: sub, url, reason });
          subOutcomes.push({
            subreddit: sub,
            status: "blocked",
            reason,
            opportunities: 0,
            url,
          });
          if (isRateLimit(wall)) {
            console.warn(
              "[scout:browser] rate-limited — stopping scout (wait several minutes before retry)"
            );
            break;
          }
          if (!alreadyTriedHitl && handOffCaptcha(sub, url, wall)) break;
          if (alreadyTriedHitl) {
            console.warn(
              `[scout:browser] r/${sub} still gated after HITL (${wall.reason}) — skipping; continuing allowlist`
            );
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
          const again = await classifyScoutPage(page, decide);
          if (again.challenged) {
            const alreadyTriedHitl = skipLoginHitl.has(sub.toLowerCase());
            const reason = alreadyTriedHitl
              ? "skipped_after_hitl"
              : (again.reason ?? "interstitial");
            blocked.push({ subreddit: sub, url, reason });
            subOutcomes.push({
              subreddit: sub,
              status: "blocked",
              reason,
              opportunities: 0,
              url,
            });
            if (isRateLimit(again)) {
              console.warn(
                "[scout:browser] rate-limited — stopping scout (wait several minutes before retry)"
              );
              break;
            }
            if (!alreadyTriedHitl && handOffCaptcha(sub, url, again)) break;
          } else {
            console.warn(
              `[scout:browser] r/${sub} timed out waiting for listing`
            );
            timedOut.push(sub);
            subOutcomes.push({
              subreddit: sub,
              status: "timed_out",
              opportunities: 0,
              url,
            });
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

        const candidates = pickDeepReadCandidates(posts, deepReadMax, {
          excludeIds,
        });
        if (candidates.length > 0) {
          try {
            const n = await deepReadPosts(
              page,
              candidates,
              byId,
              Math.min(delayMs, 2000),
              Math.min(jitterMs, 1500),
              decide
            );
            console.log(
              `[scout:browser] r/${sub} deep-read enriched ${n}/${candidates.length}`
            );
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
            } else if (wall?.challenged && handOffCaptcha(sub, url, wall)) {
              break;
            } else {
              console.warn(`[scout:browser] r/${sub} deep-read batch error:`, err);
            }
          }
        }

        const stats = scoreListingStats(posts);
        console.log(
          `[scout:browser] r/${sub} scanned=${stats.scanned} actionable=${stats.actionable} nearMiss=${stats.nearMiss} megathreads=${stats.megathreads}`
        );

        // Spread *new* slots across allowlisted subs. Already-seen ids are
        // skipped inside listingPostsToDrafts so `limit` is per-run fresh.
        const room = limit - drafts.length;
        if (room <= 0) {
          break;
        }
        const take =
          i === subs.length - 1 ? room : Math.min(perSubCap, room);
        const mapped = listingPostsToDrafts(posts, take, { excludeIds });
        for (const d of mapped) excludeIds.add(d.id);
        drafts.push(...mapped);
        subOutcomes.push({
          subreddit: sub,
          status: "ok",
          opportunities: mapped.length,
          url,
        });
        console.log(
          `[scout:browser] r/${sub} kept ${mapped.length} new draft(s) ` +
            `(run total ${drafts.length}/${limit})`
        );

        if (
          blocked.some((b) => b.subreddit === sub && b.reason === "rate_limit")
        ) {
          break;
        }
        if (drafts.length >= limit) {
          break;
        }
      } catch (err) {
        const wall = await classifyScoutPage(page, decide).catch(() => ({
          challenged: false as const,
        }));
        if (wall.challenged) {
          const alreadyTriedHitl = skipLoginHitl.has(sub.toLowerCase());
          const reason = alreadyTriedHitl
            ? "skipped_after_hitl"
            : (wall.reason ?? "interstitial");
          blocked.push({ subreddit: sub, url, reason });
          subOutcomes.push({
            subreddit: sub,
            status: "blocked",
            reason,
            opportunities: 0,
            url,
          });
          if (isRateLimit(wall)) {
            console.warn(
              "[scout:browser] rate-limited — stopping scout (wait several minutes before retry)"
            );
            break;
          }
          if (!alreadyTriedHitl && handOffCaptcha(sub, url, wall)) break;
        } else {
          console.warn(`[scout:browser] r/${sub} failed:`, err);
          timedOut.push(sub);
          subOutcomes.push({
            subreddit: sub,
            status: "error",
            reason: err instanceof Error ? err.message : String(err),
            opportunities: 0,
            url,
          });
        }
      }

      if (i < subs.length - 1 && !handOffEngine) {
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
    // Adopted sessions stay open for the controller unless we handed off
    // (hand-off already transfers ownership). Fresh engines teardown here.
    if (!handOffEngine && !adopted) {
      await engine.teardown();
    }
  }

  const byId = new Map<string, CommunityDraft>();
  for (const d of drafts) {
    const prev = byId.get(d.id);
    if (!prev || scoreTotal(d.score) > scoreTotal(prev.score)) {
      byId.set(d.id, d);
    }
  }
  const ranked = [...byId.values()].sort(
    (a, b) => scoreTotal(b.score) - scoreTotal(a.score)
  );
  const kept = ranked.slice(0, limit);

  // Opportunity counts on subOutcomes were per-pass takes; align to final kept.
  const keptBySub = new Map<string, number>();
  for (const d of kept) {
    const key = d.subreddit.replace(/^r\//i, "").toLowerCase();
    keptBySub.set(key, (keptBySub.get(key) ?? 0) + 1);
  }
  for (const row of subOutcomes) {
    if (row.status === "ok") {
      row.opportunities =
        keptBySub.get(row.subreddit.replace(/^r\//i, "").toLowerCase()) ?? 0;
    }
  }

  return {
    drafts: kept,
    blocked,
    timedOut,
    subOutcomes,
    plannedSubs,
    challenge,
  };
}
