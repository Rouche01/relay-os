import type { CommunityDraft } from "../types.js";
import type { RedditListingPost } from "./client.js";
import { createRedditBrowserEngine } from "./browser-session.js";
import {
  allowlistedSubNames,
  getRedditEnv,
  type RedditEnvConfig,
} from "./config.js";
import { listingPostsToDrafts } from "./map-drafts.js";

export interface JsonScoutOptions {
  limit?: number;
  subreddits?: string[];
  cfg?: RedditEnvConfig;
  /** Delay between subreddit fetches (ms). */
  delayMs?: number;
  /**
   * When bare fetch is blocked (403), warm a Playwright context and re-GET JSON.
   * Default true — still “json scout” (parse listing JSON), not DOM extract.
   */
  playwrightFallback?: boolean;
  /** Already-seen draft ids — skipped so `limit` is fresh for this run. */
  excludeIds?: Iterable<string>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function jsonUserAgent(cfg: RedditEnvConfig): string {
  const ua = cfg.userAgent;
  if (!ua || /relay-community-engager/i.test(ua)) {
    return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
  }
  return ua;
}

export function publicListingUrls(
  subreddit: string,
  sort: "new" | "hot" = "new",
  limit = 25
): string[] {
  const sub = subreddit.replace(/^r\//i, "");
  const q = `limit=${limit}&raw_json=1`;
  return [
    `https://www.reddit.com/r/${encodeURIComponent(sub)}/${sort}.json?${q}`,
    `https://www.reddit.com/r/${encodeURIComponent(sub)}/${sort}/.json?${q}`,
    `https://old.reddit.com/r/${encodeURIComponent(sub)}/${sort}.json?${q}`,
  ];
}

function mapListingChildren(
  children: Array<{ data?: Record<string, unknown> }>,
  fallbackSub: string
): RedditListingPost[] {
  return children
    .map((c) => c.data)
    .filter((d): d is Record<string, unknown> => Boolean(d))
    .map((d) => {
      const id = String(d.id ?? "");
      const name = String(d.name ?? (id ? `t3_${id}` : ""));
      const permalink = String(d.permalink ?? "");
      const href = permalink.startsWith("http")
        ? permalink
        : `https://www.reddit.com${permalink}`;
      return {
        id,
        name,
        subreddit: String(d.subreddit ?? fallbackSub),
        title: String(d.title ?? ""),
        selftext: String(d.selftext ?? ""),
        url: String(d.url ?? href),
        permalink: href,
        createdUtc: Number(d.created_utc ?? 0),
        author: String(d.author ?? ""),
      };
    })
    .filter((p) => p.id && p.title);
}

function parseListingJson(
  raw: unknown,
  fallbackSub: string
): RedditListingPost[] {
  const data = raw as {
    data?: { children?: Array<{ data?: Record<string, unknown> }> };
  };
  return mapListingChildren(data.data?.children ?? [], fallbackSub);
}

async function fetchJsonHttp(
  url: string,
  ua: string
): Promise<{ ok: true; json: unknown } | { ok: false; status: number; body: string }> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": ua,
      Accept: "application/json,text/html;q=0.8,*/*;q=0.5",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });
  const body = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, body: body.slice(0, 240) };
  }
  try {
    return { ok: true, json: JSON.parse(body) };
  } catch {
    return { ok: false, status: res.status, body: body.slice(0, 240) };
  }
}

/**
 * After Reddit's JS challenge, page.request often succeeds where bare fetch 403s.
 */
async function fetchJsonViaPlaywright(
  url: string,
  cfg: RedditEnvConfig
): Promise<unknown> {
  const { engine } = await createRedditBrowserEngine({
    cfg,
    useStoredSession: true,
  });
  try {
    const page = await engine.getPage();
    // Warm host / clear challenge cookies
    await page.goto("https://www.reddit.com/", {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await sleep(1500);
    const res = await page.request.get(url, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok()) {
      const body = await res.text();
      throw new Error(`Playwright GET ${res.status()} ${body.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    await engine.teardown();
  }
}

async function fetchListingForSub(
  sub: string,
  cfg: RedditEnvConfig,
  playwrightFallback: boolean
): Promise<RedditListingPost[]> {
  const ua = jsonUserAgent(cfg);
  const urls = publicListingUrls(sub, "new", 25);
  let lastErr: string | undefined;

  for (const url of urls) {
    const result = await fetchJsonHttp(url, ua);
    if (result.ok) {
      return parseListingJson(result.json, sub);
    }
    lastErr = `HTTP ${result.status} via ${url}`;
    console.warn(`[scout:json] ${lastErr}`);
  }

  if (playwrightFallback) {
    console.warn(
      `[scout:json] r/${sub} bare fetch blocked; retrying JSON via Playwright request…`
    );
    const json = await fetchJsonViaPlaywright(urls[0]!, cfg);
    return parseListingJson(json, sub);
  }

  throw new Error(lastErr ?? `r/${sub} json listing failed`);
}

/**
 * Read-only scout via public Reddit listing JSON (no OAuth).
 * Optional escape hatch when DOM scout fails or SCOUT_SOURCE=json.
 *
 * Bare `fetch` often gets HTTP 403 from Reddit’s network security; we then retry
 * the same JSON URL via Playwright `page.request` after warming www.reddit.com.
 * If JSON is still blocked (common on some IPs), this returns empty and callers
 * fall through to oauth/fixtures — browser DOM scout remains the primary path.
 *
 * Never writes.
 */
export async function scoutRedditJson(
  opts: JsonScoutOptions = {}
): Promise<CommunityDraft[]> {
  const cfg = opts.cfg ?? getRedditEnv();
  const subs = opts.subreddits?.length ? opts.subreddits : allowlistedSubNames();
  const limit = opts.limit ?? 5;
  const delayMs = opts.delayMs ?? cfg.scoutDelayMs;
  const playwrightFallback = opts.playwrightFallback ?? true;
  const drafts: CommunityDraft[] = [];
  const excludeIds = new Set(opts.excludeIds ?? []);

  for (let i = 0; i < subs.length; i++) {
    const sub = subs[i]!;
    console.log(`[scout:json] r/${sub}`);

    try {
      const posts = await fetchListingForSub(sub, cfg, playwrightFallback);
      console.log(`[scout:json] r/${sub} extracted ${posts.length} posts`);
      const mapped = listingPostsToDrafts(posts, limit - drafts.length, {
        excludeIds,
      });
      for (const d of mapped) excludeIds.add(d.id);
      drafts.push(...mapped);
      if (drafts.length >= limit) return drafts;
    } catch (err) {
      console.warn(`[scout:json] r/${sub} failed:`, err);
    }

    if (i < subs.length - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  return drafts;
}
