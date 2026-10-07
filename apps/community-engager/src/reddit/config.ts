import path from "node:path";
import type { OpportunityScore } from "../types.js";

/** Allowlisted fashion/styling subs for read scout + soft-mention policy notes. */
export interface SubredditPolicy {
  name: string;
  /** When false, never enqueue (rules ban promo / self-promo risk). */
  rulesOk: boolean;
  note: string;
}

export const ALLOWLISTED_SUBREDDITS: SubredditPolicy[] = [
  {
    name: "femalefashionadvice",
    rulesOk: true,
    note: "Help-first; soft founder mention OK; avoid hard links unless disclosure + human OK.",
  },
  {
    name: "malefashionadvice",
    rulesOk: true,
    note: "Advice-heavy culture; intensity 0–1 default; disclose if naming a product.",
  },
  {
    name: "fashion",
    rulesOk: true,
    note: "Broader audience; keep value-without-app high; no spammy hauls.",
  },
  {
    name: "OldFashionedFashion",
    rulesOk: true,
    note: "Niche; prefer pure advice unless clearly welcomed.",
  },
];

export function getSubredditPolicy(name: string): SubredditPolicy | undefined {
  const n = name.replace(/^r\//i, "").toLowerCase();
  return ALLOWLISTED_SUBREDDITS.find((s) => s.name.toLowerCase() === n);
}

export function allowlistedSubNames(): string[] {
  return ALLOWLISTED_SUBREDDITS.filter((s) => s.rulesOk).map((s) => s.name);
}

/** Scout input source. `oauth` is an alias of `reddit`. `json` reserved (Phase 4). */
export type ScoutSource =
  | "fixtures"
  | "reddit"
  | "oauth"
  | "browser"
  | "json"
  | "auto";

/** Write (and preferred) transport. */
export type RedditTransport =
  | "auto"
  | "browser"
  | "oauth"
  | "json"
  | "fixtures";

export interface RedditEnvConfig {
  clientId?: string;
  clientSecret?: string;
  username?: string;
  password?: string;
  userAgent: string;
  /**
   * True when OAuth script-app credentials are present
   * (CLIENT_ID + SECRET + username + password).
   */
  oauthConfigured: boolean;
  /** @deprecated Alias of oauthConfigured — kept for older call sites. */
  configured: boolean;
  /** Username + password only (enough for future browser login; no API app). */
  hasUserPass: boolean;
  /** When true (default), never call write APIs / live browser post. */
  dryRun: boolean;
  scoutSource: ScoutSource;
  /** Preferred execute transport (`REDDIT_TRANSPORT`). */
  transport: RedditTransport;
  lpBaseUrl: string;
  /** Playwright headless (default true). */
  browserHeadless: boolean;
  /** Base delay between allowlisted subs during browser scout (ms). */
  scoutDelayMs: number;
  /** Random extra delay 0…jitter added to scoutDelayMs (human pacing). */
  scoutDelayJitterMs: number;
  /** Cap how many allowlisted subs to visit this run (default all). */
  scoutMaxSubs: number;
  /** Scroll rounds on each /new feed to load more posts (human browse depth). */
  scoutScrollRounds: number;
  /** Max thread deep-reads per sub (open permalink for full OP body). */
  scoutDeepReadMax: number;
  /** Max time per sub during browser scout (ms). Default 12s. */
  scoutSubBudgetMs: number;
  /**
   * When true, a detected interstitial opens a headed browser and pauses
   * for human Approve via Telegram/CLI (solve in the window, then Approve).
   * Default: on when scout is headed or REDDIT_LOGIN_HEADED; off for unattended headless.
   */
  interstitialHitl: boolean;
  /** App data root (jobs, cookies). Default `.data`. */
  dataDir: string;
  /** Cookie / storageState directory for browser session. */
  cookieDir: string;
  /**
   * Discover stage mode (`COMMUNITY_DISCOVER`).
   * - auto: run only when postable allowlist is thin
   * - force: always research this run
   * - off: never run
   */
  discoverMode: DiscoverMode;
  /** @deprecated Prefer discoverMode; true when mode !== "off". */
  discoverEnabled: boolean;
  /** Reddit subreddit search query for discovery. */
  discoverQuery: string;
  /** Max discovery candidates to propose per run. */
  discoverMaxCandidates: number;
  /**
   * Auto mode: skip discover when postable count ≥ this.
   * Default = seed allowlist size (rulesOk subs).
   */
  discoverMinPostable: number;
  /**
   * When true, scout reserves one slot for a human-promoted discovered sub
   * (exploration among already-approved allowlist entries).
   */
  discoverExploreSlot: boolean;
  /**
   * Goal string for discover-fit DecisionPort (Noul).
   * Env: COMMUNITY_DISCOVER_GOAL.
   */
  discoverGoal: string;
}

/** COMMUNITY_DISCOVER=auto|force|off (true→force, false→off). */
export type DiscoverMode = "auto" | "force" | "off";

export function parseDiscoverMode(raw: string | undefined): DiscoverMode {
  const v = (raw ?? "auto").trim().toLowerCase();
  if (v === "off" || v === "false" || v === "0" || v === "no") return "off";
  if (v === "force" || v === "true" || v === "1" || v === "yes" || v === "on") {
    return "force";
  }
  if (v === "auto") return "auto";
  // Unknown values: treat as auto (safe default — skip when healthy).
  return "auto";
}

export function seedPostableCount(): number {
  return ALLOWLISTED_SUBREDDITS.filter((s) => s.rulesOk).length;
}

function parseScoutSource(raw: string): ScoutSource {
  const v = raw.toLowerCase();
  if (
    v === "fixtures" ||
    v === "reddit" ||
    v === "oauth" ||
    v === "browser" ||
    v === "json"
  ) {
    return v;
  }
  return "auto";
}

function parseTransport(raw: string): RedditTransport {
  const v = raw.toLowerCase();
  if (
    v === "browser" ||
    v === "oauth" ||
    v === "json" ||
    v === "fixtures"
  ) {
    return v;
  }
  return "auto";
}

/** Normalize scout source aliases (`oauth` → treat like reddit OAuth path). */
export function isOauthScoutSource(source: ScoutSource): boolean {
  return source === "reddit" || source === "oauth";
}

/**
 * Resolve which write path execute should use (ignoring dry-run).
 * `auto`: prefer browser (HITL); oauth only when no user/pass (API-app-only setup).
 */
export function resolveWriteTransport(
  cfg: RedditEnvConfig
): "browser" | "oauth" | "none" {
  const t = cfg.transport;
  if (t === "browser") return "browser";
  if (t === "oauth") return cfg.oauthConfigured ? "oauth" : "none";
  if (t === "json" || t === "fixtures") return "none";
  // auto — HITL browser first; OAuth when that's the only viable write path
  if (cfg.hasUserPass) return "browser";
  if (cfg.oauthConfigured) return "oauth";
  return "browser";
}

/**
 * Ordered write attempts for `auto` (and explicit transports as a one-item list).
 * Used so OAuth remains an optional fast path after browser failure.
 */
export function resolveWriteTransportChain(
  cfg: RedditEnvConfig
): Array<"browser" | "oauth"> {
  const t = cfg.transport;
  if (t === "browser") return ["browser"];
  if (t === "oauth") return cfg.oauthConfigured ? ["oauth"] : [];
  if (t === "json" || t === "fixtures") return [];
  // auto
  const chain: Array<"browser" | "oauth"> = ["browser"];
  if (cfg.oauthConfigured) chain.push("oauth");
  return chain;
}

export function getRedditEnv(
  env: NodeJS.ProcessEnv = process.env
): RedditEnvConfig {
  const clientId = env.REDDIT_CLIENT_ID;
  const clientSecret = env.REDDIT_CLIENT_SECRET;
  const username = env.REDDIT_USERNAME;
  const password = env.REDDIT_PASSWORD;
  const oauthConfigured = Boolean(
    clientId && clientSecret && username && password
  );
  const hasUserPass = Boolean(username && password);
  const dryRun = env.REDDIT_DRY_RUN !== "false" && env.REDDIT_DRY_RUN !== "0";
  const scoutSource = parseScoutSource(env.SCOUT_SOURCE ?? "auto");
  const transport = parseTransport(env.REDDIT_TRANSPORT ?? "auto");

  // Default 8s base — 1.5s across 4 subs looks automated and trips IP walls.
  const delayRaw = Number(env.REDDIT_SCOUT_DELAY_MS ?? "8000");
  const scoutDelayMs =
    Number.isFinite(delayRaw) && delayRaw >= 0 ? delayRaw : 8000;

  const jitterRaw = Number(env.REDDIT_SCOUT_DELAY_JITTER_MS ?? "4000");
  const scoutDelayJitterMs =
    Number.isFinite(jitterRaw) && jitterRaw >= 0 ? jitterRaw : 4000;

  const maxSubsRaw = Number(env.REDDIT_SCOUT_MAX_SUBS ?? "0");
  const scoutMaxSubs =
    Number.isFinite(maxSubsRaw) && maxSubsRaw > 0 ? Math.floor(maxSubsRaw) : 0;

  const scrollRaw = Number(env.REDDIT_SCOUT_SCROLL_ROUNDS ?? "4");
  const scoutScrollRounds =
    Number.isFinite(scrollRaw) && scrollRaw >= 0 ? Math.floor(scrollRaw) : 4;

  const deepRaw = Number(env.REDDIT_SCOUT_DEEP_READ_MAX ?? "5");
  const scoutDeepReadMax =
    Number.isFinite(deepRaw) && deepRaw >= 0 ? Math.floor(deepRaw) : 5;

  // Deeper browse needs more wall-clock per sub (scroll + deep-reads).
  const budgetRaw = Number(env.REDDIT_SCOUT_SUB_BUDGET_MS ?? "45000");
  const scoutSubBudgetMs =
    Number.isFinite(budgetRaw) && budgetRaw >= 3000 ? budgetRaw : 45_000;

  const browserHeadless =
    env.REDDIT_BROWSER_HEADLESS !== "false" &&
    env.REDDIT_BROWSER_HEADLESS !== "0";
  const loginHeaded =
    env.REDDIT_LOGIN_HEADED === "true" || env.REDDIT_LOGIN_HEADED === "1";
  const hitlRaw = (env.REDDIT_INTERSTITIAL_HITL ?? "").toLowerCase();
  let interstitialHitl: boolean;
  if (hitlRaw === "false" || hitlRaw === "0") interstitialHitl = false;
  else if (hitlRaw === "true" || hitlRaw === "1") interstitialHitl = true;
  else interstitialHitl = !browserHeadless || loginHeaded;

  const dataDir = path.resolve(
    process.cwd(),
    env.REDDIT_DATA_DIR?.trim() || ".data"
  );
  const cookieDir = path.resolve(
    process.cwd(),
    env.REDDIT_COOKIE_DIR?.trim() || path.join(".data", "cookies", "reddit")
  );

  // Default auto: skip research when postable allowlist is already healthy.
  const discoverMode = parseDiscoverMode(env.COMMUNITY_DISCOVER ?? "auto");
  const discoverEnabled = discoverMode !== "off";
  const discoverQuery =
    env.COMMUNITY_DISCOVER_QUERY?.trim() ||
    "fashion style advice wardrobe";
  const discoverMaxRaw = Number(env.COMMUNITY_DISCOVER_MAX ?? "5");
  const discoverMaxCandidates =
    Number.isFinite(discoverMaxRaw) && discoverMaxRaw > 0
      ? Math.floor(discoverMaxRaw)
      : 5;
  const minPostableRaw = Number(
    env.COMMUNITY_DISCOVER_MIN_POSTABLE ?? String(seedPostableCount())
  );
  const discoverMinPostable =
    Number.isFinite(minPostableRaw) && minPostableRaw > 0
      ? Math.floor(minPostableRaw)
      : seedPostableCount();
  const exploreRaw = (env.COMMUNITY_DISCOVER_EXPLORE ?? "true").toLowerCase();
  const discoverExploreSlot =
    exploreRaw !== "false" && exploreRaw !== "0" && exploreRaw !== "off";
  const discoverGoal =
    env.COMMUNITY_DISCOVER_GOAL?.trim() ||
    "Help-first fashion and styling communities for GoStylens. Soft product mention OK when useful; never hard-sell or spam.";

  return {
    clientId,
    clientSecret,
    username,
    password,
    userAgent:
      env.REDDIT_USER_AGENT ?? "relay-community-engager/0.1 by relay-os",
    oauthConfigured,
    configured: oauthConfigured,
    hasUserPass,
    dryRun,
    scoutSource,
    transport,
    lpBaseUrl: env.GOSTYLENS_LP_BASE_URL ?? "https://gostylens.app",
    browserHeadless,
    scoutDelayMs,
    scoutDelayJitterMs,
    scoutMaxSubs,
    scoutScrollRounds,
    scoutDeepReadMax,
    scoutSubBudgetMs,
    interstitialHitl,
    dataDir,
    cookieDir,
    discoverMode,
    discoverEnabled,
    discoverQuery,
    discoverMaxCandidates,
    discoverMinPostable,
    discoverExploreSlot,
    discoverGoal,
  };
}

/** Empty score template. */
export function emptyScore(): OpportunityScore {
  return {
    problemFit: false,
    wantsHelp: false,
    rulesOk: false,
    freshnessOk: false,
    valueWithoutApp: false,
  };
}
