import type { Page } from "playwright";
import type { DecisionPort } from "@relay/engines-decide";
import {
  createDecisionPort,
  discoverMinConfidence,
} from "@relay/engines-decide";
import type { PlaywrightEngine } from "@relay/engines-browser";
import {
  DEFAULT_DISCOVER_GOAL,
  scoreDiscoverFit,
} from "../discover-fit.js";
import type { RedditEnvConfig } from "./config.js";
import { getRedditEnv } from "./config.js";
import { createRedditBrowserEngine } from "./browser-session.js";
import { storageStatePath } from "./cookies.js";
import {
  detectInterstitial,
  isRateLimit,
  type InterstitialDetection,
} from "./interstitial.js";

export interface DiscoveryCandidate {
  name: string;
  title: string;
  subscribers: number;
  publicDescription: string;
  /** 0–10 display score (decide confidence × 10). */
  fitScore: number;
  rulesOk: boolean;
  note: string;
  evidence: string;
}

export interface DiscoverChallengeHandOff {
  engine: PlaywrightEngine;
  storagePath: string;
  url: string;
  reason: string;
  title?: string;
}

export interface DiscoverSubsResult {
  candidates: DiscoveryCandidate[];
  /** When set, headed browser is still open — caller owns teardown via interstitial session. */
  challenge?: DiscoverChallengeHandOff;
}

export interface DiscoverSubsOptions {
  cfg?: RedditEnvConfig;
  query?: string;
  limit?: number;
  exclude?: string[];
  /**
   * When true (default follows interstitialHitl), open a headed window and
   * hand it off for Telegram/CLI CAPTCHA solve instead of failing quiet.
   */
  escalateCaptcha?: boolean;
  /**
   * Continue in an already-cleared headed browser (do not teardown on close).
   * Avoids Reddit re-challenging a brand-new Chromium after HITL.
   */
  adopt?: { engine: PlaywrightEngine; storagePath: string };
  /** Fit scorer — defaults to createDecisionPort() from env. */
  decide?: DecisionPort;
  /** Community goal for Noul fit. */
  goal?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cheap hard veto — never send obvious promo-hostile bios to decide as “rules OK”. */
const PROMO_BAN_RE =
  /\b(no self[- ]?promo|no advertising|no spam|no affiliate|banned.*promo)\b/i;

const MAX_SAMPLE_SUBS = 8;

function jsonUserAgent(cfg: RedditEnvConfig): string {
  const ua = cfg.userAgent;
  if (!ua || /relay-community-engager/i.test(ua)) {
    return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
  }
  return ua;
}

async function fetchJsonHttp(
  url: string,
  ua: string
): Promise<{ ok: true; json: unknown } | { ok: false; status: number }> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": ua,
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, json: await res.json() };
  } catch {
    return { ok: false, status: 0 };
  }
}

class DiscoverJsonSession {
  private engine: PlaywrightEngine | null = null;
  private page: Page | null = null;
  private warmed = false;
  private storagePath: string;
  private headless: boolean;
  /** Caller owns teardown (adopted post-CAPTCHA session or hand-off). */
  private adopted = false;
  /** When set, do not teardown in close() — controller owns the headed window. */
  private handOff: DiscoverChallengeHandOff | null = null;

  constructor(
    private readonly cfg: RedditEnvConfig,
    private readonly escalateCaptcha: boolean,
    adopt?: { engine: PlaywrightEngine; storagePath: string }
  ) {
    this.storagePath = adopt?.storagePath ?? storageStatePath(cfg);
    this.headless = adopt ? false : cfg.browserHeadless;
    if (adopt) {
      this.engine = adopt.engine;
      this.storagePath = adopt.storagePath;
      this.adopted = true;
      // Session already survived a challenge — skip home warm-up re-probe.
      this.warmed = true;
    }
  }

  getChallenge(): DiscoverChallengeHandOff | null {
    return this.handOff;
  }

  async getJson(urls: string[]): Promise<unknown | null> {
    if (this.handOff) return null;
    const ua = jsonUserAgent(this.cfg);
    for (const url of urls) {
      const http = await fetchJsonHttp(url, ua);
      if (http.ok) return http.json;
    }

    const page = await this.ensurePage();
    if (this.handOff) return null;

    for (const url of urls) {
      try {
        const res = await page.request.get(url, {
          headers: { "User-Agent": ua, Accept: "application/json" },
        });
        if (res.ok()) return await res.json();
      } catch {
        /* try next */
      }
    }

    // JSON still empty — load first URL in the page and check for CAPTCHA wall.
    const probeUrl = urls[0];
    if (probeUrl) {
      await this.probeChallenge(probeUrl);
    }
    return null;
  }

  private async ensurePage(): Promise<Page> {
    if (this.page) return this.page;
    if (this.engine) {
      this.page = await this.engine.getPage();
      return this.page;
    }
    console.log(
      `[discover] opening shared Playwright session (headless=${this.headless})`
    );
    const { engine, storagePath } = await createRedditBrowserEngine({
      cfg: this.cfg,
      useStoredSession: true,
      headless: this.headless,
    });
    this.engine = engine;
    this.storagePath = storagePath;
    this.page = await engine.getPage();
    if (!this.warmed) {
      const warmUrl = "https://www.reddit.com/";
      try {
        await this.page.goto(warmUrl, {
          waitUntil: "domcontentloaded",
          timeout: 12_000,
        });
        await this.checkPageForChallenge(warmUrl);
      } catch (err) {
        console.warn("[discover] warm-up navigation failed:", err);
      }
      this.warmed = true;
    }
    return this.page!;
  }

  private async probeChallenge(url: string): Promise<void> {
    if (this.handOff || !this.page) return;
    try {
      await this.page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });
      await this.checkPageForChallenge(url);
    } catch (err) {
      console.warn("[discover] challenge probe failed:", err);
    }
  }

  private async checkPageForChallenge(url: string): Promise<void> {
    if (!this.page || this.handOff) return;
    const wall = await detectInterstitial(this.page);
    if (!wall.challenged) return;

    if (isRateLimit(wall)) {
      console.warn(
        `[discover] rate-limited (${wall.reason}) — cool down; not escalating CAPTCHA HITL`
      );
      return;
    }

    console.warn(
      `[discover] blocked (${wall.reason ?? "interstitial"}) — ${wall.title ?? url}`
    );

    if (!this.escalateCaptcha) {
      console.warn(
        "[discover] CAPTCHA HITL off — set REDDIT_INTERSTITIAL_HITL=true (or headed) to escalate via Telegram"
      );
      return;
    }

    await this.escalateHeaded(url, wall);
  }

  /**
   * Keep a headed browser open on the challenge page for the human.
   * Detaches ownership from this session so close() won't kill the window.
   */
  private async escalateHeaded(
    url: string,
    wall: InterstitialDetection
  ): Promise<void> {
    // Prefer reusing current window if already headed.
    if (!this.headless && this.engine && this.page) {
      this.handOff = {
        engine: this.engine,
        storagePath: this.storagePath,
        url: this.page.url() || url,
        reason: wall.reason ?? "interstitial",
        title: wall.title,
      };
      this.engine = null;
      this.page = null;
      console.log(
        "[discover] headed challenge window kept open — waiting for Telegram/CLI Approve"
      );
      return;
    }

    // Headless can't show CAPTCHA — open a headed window and hand it off.
    if (this.engine) {
      try {
        await this.engine.teardown();
      } catch {
        /* ignore */
      }
      this.engine = null;
      this.page = null;
    }

    console.log(
      "[discover] escalating CAPTCHA — opening headed browser for human solve"
    );
    const { engine, storagePath } = await createRedditBrowserEngine({
      cfg: this.cfg,
      useStoredSession: true,
      headless: false,
    });
    const page = await engine.getPage();
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });
    } catch (err) {
      console.warn("[discover] headed goto failed:", err);
    }

    const again = await detectInterstitial(page);
    if (!again.challenged) {
      await engine.saveStorageState(storagePath);
      await engine.teardown();
      console.log(
        `[discover] challenge cleared without HITL — saved jar → ${storagePath}`
      );
      return;
    }

    this.handOff = {
      engine,
      storagePath,
      url: page.url() || url,
      reason: again.reason ?? wall.reason ?? "interstitial",
      title: again.title ?? wall.title,
    };
    console.log(
      "[discover] headed challenge window open — solve CAPTCHA; auto-detects clear (or Approve)"
    );
  }

  async close(): Promise<void> {
    if (this.handOff || this.adopted) {
      // Ownership stays with controller / interstitial session.
      this.engine = null;
      this.page = null;
      return;
    }
    if (!this.engine) return;
    try {
      await this.engine.teardown();
    } catch (err) {
      console.warn("[discover] shared session teardown:", err);
    }
    this.engine = null;
    this.page = null;
  }
}

interface SearchChild {
  data?: {
    display_name?: string;
    title?: string;
    public_description?: string;
    subscribers?: number;
    over18?: boolean;
    subreddit_type?: string;
  };
}

async function sampleNewTitles(
  sub: string,
  session: DiscoverJsonSession
): Promise<string[]> {
  if (session.getChallenge()) return [];
  const urls = [
    `https://www.reddit.com/r/${encodeURIComponent(sub)}/new.json?limit=15&raw_json=1`,
    `https://old.reddit.com/r/${encodeURIComponent(sub)}/new.json?limit=15&raw_json=1`,
  ];
  const json = await session.getJson(urls);
  if (!json) return [];
  const children =
    (json as { data?: { children?: Array<{ data?: { title?: string } }> } })
      .data?.children ?? [];
  return children
    .map((c) => String(c.data?.title ?? ""))
    .filter((t) => t.length > 0);
}

/**
 * Read-only subreddit discovery via public search + DecisionPort fit.
 * Hard vetoes (NSFW / non-public) stay in code. Fit uses Noul via decide —
 * never auto-promotes to postable.
 * On CAPTCHA, may return challenge hand-off with headed browser still open.
 */
export async function discoverSubredditCandidates(
  opts: DiscoverSubsOptions = {}
): Promise<DiscoverSubsResult> {
  const cfg = opts.cfg ?? getRedditEnv();
  const query =
    opts.query?.trim() ||
    cfg.discoverQuery ||
    "fashion style advice wardrobe";
  const limit = opts.limit ?? cfg.discoverMaxCandidates;
  const exclude = new Set(
    (opts.exclude ?? []).map((s) => s.replace(/^r\//i, "").toLowerCase())
  );
  const escalateCaptcha = opts.escalateCaptcha ?? cfg.interstitialHitl;
  const decide = opts.decide ?? createDecisionPort();
  const goal = opts.goal?.trim() || cfg.discoverGoal || DEFAULT_DISCOVER_GOAL;
  const minConfidence = discoverMinConfidence();

  const searchUrls = [
    `https://www.reddit.com/subreddits/search.json?q=${encodeURIComponent(query)}&limit=25&raw_json=1`,
    `https://old.reddit.com/subreddits/search.json?q=${encodeURIComponent(query)}&limit=25&raw_json=1`,
  ];

  console.log(
    `[discover] query=${JSON.stringify(query)} limit=${limit} decide=${decide.backendName} floor=${minConfidence.toFixed(2)}`
  );
  const session = new DiscoverJsonSession(cfg, escalateCaptcha, opts.adopt);
  if (opts.adopt) {
    console.log("[discover] continuing in existing headed browser (post-CAPTCHA)");
  }
  try {
    const searchJson = await session.getJson(searchUrls);
    const challenge = session.getChallenge();
    if (challenge) {
      return { candidates: [], challenge };
    }
    if (!searchJson) {
      console.warn("[discover] subreddit search returned nothing");
      return { candidates: [] };
    }

    const children =
      (searchJson as { data?: { children?: SearchChild[] } }).data?.children ??
      [];

    const ranked: DiscoveryCandidate[] = [];
    let sampled = 0;

    for (const child of children) {
      if (session.getChallenge()) break;
      if (ranked.length >= limit) break;
      const d = child.data;
      if (!d?.display_name) continue;
      const name = String(d.display_name);
      if (exclude.has(name.toLowerCase())) continue;
      // Hard vetoes — never ask decide about junk.
      if (d.over18) continue;
      if (d.subreddit_type && d.subreddit_type !== "public") continue;

      const title = String(d.title ?? name);
      const publicDescription = String(d.public_description ?? "");
      const subscribers = Number(d.subscribers ?? 0);
      const promoBan = PROMO_BAN_RE.test(`${title}\n${publicDescription}`);

      let fit = await scoreDiscoverFit(
        decide,
        {
          name,
          title,
          publicDescription,
          subscribers,
          goal,
        },
        { minConfidence }
      );

      let sampleTitles: string[] = [];
      if (fit.wantSamples && sampled < MAX_SAMPLE_SUBS) {
        sampleTitles = await sampleNewTitles(name, session);
        sampled += 1;
        if (session.getChallenge()) break;
        await sleep(Math.min(cfg.scoutDelayMs, 1500));
        if (sampleTitles.length) {
          fit = await scoreDiscoverFit(
            decide,
            {
              name,
              title,
              publicDescription,
              subscribers,
              sampleTitles,
              goal,
            },
            { minConfidence }
          );
        }
      }

      if (!fit.propose) {
        console.log(
          `[discover] drop r/${name} confidence=${fit.confidence.toFixed(2)} fit=${fit.fitYes}`
        );
        continue;
      }

      const rulesOk = fit.rulesOk && !promoBan;
      ranked.push({
        name,
        title,
        subscribers,
        publicDescription: publicDescription.slice(0, 280),
        fitScore: fit.fitScore,
        rulesOk,
        note: promoBan
          ? `${fit.note} Cheap promo-ban hint in bio — help-only if promoted.`
          : fit.note,
        evidence: promoBan ? `${fit.evidence}; promo_ban_hint` : fit.evidence,
      });
      console.log(
        `[discover] propose r/${name} confidence=${fit.confidence.toFixed(2)} backend=${fit.backend}`
      );
    }

    const finalChallenge = session.getChallenge();
    if (finalChallenge) {
      return { candidates: ranked, challenge: finalChallenge };
    }

    ranked.sort(
      (a, b) => b.fitScore - a.fitScore || b.subscribers - a.subscribers
    );
    return { candidates: ranked.slice(0, limit) };
  } finally {
    await session.close();
  }
}
