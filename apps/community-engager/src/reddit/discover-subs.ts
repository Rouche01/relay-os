import type { RedditEnvConfig } from "./config.js";
import { getRedditEnv } from "./config.js";
import { createRedditBrowserEngine } from "./browser-session.js";

export interface DiscoveryCandidate {
  name: string;
  title: string;
  subscribers: number;
  publicDescription: string;
  /** Heuristic 0–10 topic/activity/help density. */
  fitScore: number;
  rulesOk: boolean;
  note: string;
  evidence: string;
}

export interface DiscoverSubsOptions {
  cfg?: RedditEnvConfig;
  /** Search query for Reddit subreddit search. */
  query?: string;
  /** Max candidates to return after scoring/filter. */
  limit?: number;
  /** Sub names already postable — excluded from proposals. */
  exclude?: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const HELP_RE =
  /\b(advice|help|recommend|suggest|tips?|what should|how (do|can|should)|outfit|wardrobe|style)\b/i;
const PROMO_BAN_RE =
  /\b(no self[- ]?promo|no advertising|no spam|no affiliate|banned.*promo)\b/i;
const TOPIC_RE =
  /\b(fashion|style|outfit|wardrobe|clothing|dress|menswear|womenswear|capsule)\b/i;

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

async function fetchJsonWithFallback(
  urls: string[],
  cfg: RedditEnvConfig
): Promise<unknown | null> {
  const ua = jsonUserAgent(cfg);
  for (const url of urls) {
    const http = await fetchJsonHttp(url, ua);
    if (http.ok) return http.json;
  }

  // Playwright request context often bypasses bare-fetch 403.
  try {
    const { engine } = await createRedditBrowserEngine({
      cfg,
      useStoredSession: true,
    });
    try {
      const page = await engine.getPage();
      await page.goto("https://www.reddit.com/", {
        waitUntil: "domcontentloaded",
        timeout: 12_000,
      });
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
    } finally {
      await engine.teardown();
    }
  } catch (err) {
    console.warn("[discover] playwright JSON fallback failed:", err);
  }
  return null;
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

function scoreCandidate(input: {
  name: string;
  title: string;
  description: string;
  subscribers: number;
  sampleTitles: string[];
}): Omit<DiscoveryCandidate, "name" | "title" | "subscribers" | "publicDescription"> {
  const blob = `${input.title}\n${input.description}`.toLowerCase();
  let fit = 0;
  if (TOPIC_RE.test(blob)) fit += 3;
  if (HELP_RE.test(blob)) fit += 2;
  if (input.subscribers >= 50_000) fit += 2;
  else if (input.subscribers >= 5_000) fit += 1;
  const helpPosts = input.sampleTitles.filter((t) => HELP_RE.test(t)).length;
  if (helpPosts >= 3) fit += 2;
  else if (helpPosts >= 1) fit += 1;

  const promoBan = PROMO_BAN_RE.test(blob);
  const rulesOk = !promoBan;
  const note = promoBan
    ? "Rules look hostile to promo — help-only if promoted; human must confirm."
    : "Topic/activity look relevant for fashion/styling advice.";
  const evidence = [
    `subs=${input.subscribers}`,
    `helpTitles=${helpPosts}/${input.sampleTitles.length}`,
    promoBan ? "promo_ban_hint" : "no_promo_ban_hint",
  ].join("; ");

  return { fitScore: Math.min(10, fit), rulesOk, note, evidence };
}

async function sampleNewTitles(
  sub: string,
  cfg: RedditEnvConfig
): Promise<string[]> {
  const urls = [
    `https://www.reddit.com/r/${encodeURIComponent(sub)}/new.json?limit=15&raw_json=1`,
    `https://old.reddit.com/r/${encodeURIComponent(sub)}/new.json?limit=15&raw_json=1`,
  ];
  const json = await fetchJsonWithFallback(urls, cfg);
  if (!json) return [];
  const children =
    (json as { data?: { children?: Array<{ data?: { title?: string } }> } })
      .data?.children ?? [];
  return children
    .map((c) => String(c.data?.title ?? ""))
    .filter((t) => t.length > 0);
}

/**
 * Read-only subreddit discovery via public search + listing samples.
 * Never posts. Never promotes — caller must HITL-promote into allowlist.
 */
export async function discoverSubredditCandidates(
  opts: DiscoverSubsOptions = {}
): Promise<DiscoveryCandidate[]> {
  const cfg = opts.cfg ?? getRedditEnv();
  const query =
    opts.query?.trim() ||
    cfg.discoverQuery ||
    "fashion style advice wardrobe";
  const limit = opts.limit ?? cfg.discoverMaxCandidates;
  const exclude = new Set(
    (opts.exclude ?? []).map((s) => s.replace(/^r\//i, "").toLowerCase())
  );

  const searchUrls = [
    `https://www.reddit.com/subreddits/search.json?q=${encodeURIComponent(query)}&limit=25&raw_json=1`,
    `https://old.reddit.com/subreddits/search.json?q=${encodeURIComponent(query)}&limit=25&raw_json=1`,
  ];

  console.log(`[discover] query=${JSON.stringify(query)} limit=${limit}`);
  const searchJson = await fetchJsonWithFallback(searchUrls, cfg);
  if (!searchJson) {
    console.warn("[discover] subreddit search returned nothing");
    return [];
  }

  const children =
    (searchJson as { data?: { children?: SearchChild[] } }).data?.children ??
    [];

  const ranked: DiscoveryCandidate[] = [];
  for (const child of children) {
    const d = child.data;
    if (!d?.display_name) continue;
    const name = String(d.display_name);
    if (exclude.has(name.toLowerCase())) continue;
    if (d.over18) continue;
    if (d.subreddit_type && d.subreddit_type !== "public") continue;

    const sampleTitles = await sampleNewTitles(name, cfg);
    await sleep(Math.min(cfg.scoutDelayMs, 2000));

    const scored = scoreCandidate({
      name,
      title: String(d.title ?? name),
      description: String(d.public_description ?? ""),
      subscribers: Number(d.subscribers ?? 0),
      sampleTitles,
    });

    if (scored.fitScore < 4) continue;

    ranked.push({
      name,
      title: String(d.title ?? name),
      subscribers: Number(d.subscribers ?? 0),
      publicDescription: String(d.public_description ?? "").slice(0, 280),
      ...scored,
    });
  }

  ranked.sort((a, b) => b.fitScore - a.fitScore || b.subscribers - a.subscribers);
  return ranked.slice(0, limit);
}
