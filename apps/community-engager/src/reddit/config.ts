import path from "node:path";
import type { OpportunityScore } from "../types.js";
import {
  envBool,
  envNumber,
  envString,
  loadAppConfig,
  type CommunityAppConfig,
} from "../app-config.js";

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

/** COMMUNITY_DISCOVER=auto|force|off (true→force, false→off). */
export type DiscoverMode = "auto" | "force" | "off";

/** COMMUNITY_WARMUP=auto|force|off (true→force, false→off). */
export type WarmupMode = "auto" | "force" | "off";

/** Secrets, paths, and Reddit host toggles (from .env). */
export interface RedditSessionConfig {
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
  /** Username + password only (enough for browser login; no API app). */
  hasUserPass: boolean;
  /** When true (default), never call write APIs / live browser post. */
  dryRun: boolean;
  /** Preferred execute transport (`REDDIT_TRANSPORT`). */
  transport: RedditTransport;
  /** Playwright headless (default true). */
  browserHeadless: boolean;
  /**
   * When true, a detected interstitial opens a headed browser and pauses
   * for human Approve via Telegram/CLI.
   */
  interstitialHitl: boolean;
  /** App data root (jobs, cookies, warmup). Default `.data`. */
  dataDir: string;
  /** Cookie / storageState directory for browser session. */
  cookieDir: string;
}

export interface WarmupRuntimeConfig {
  mode: WarmupMode;
  minAccountDays: number;
  minKarma: number;
  minHelpComments: number;
}

export interface DiscoverRuntimeConfig {
  mode: DiscoverMode;
  /** True when mode !== "off". */
  enabled: boolean;
  query: string;
  maxCandidates: number;
  minPostable: number;
  exploreSlot: boolean;
  goal: string;
  requeueDays: number;
}

export interface ScoutRuntimeConfig {
  source: ScoutSource;
  delayMs: number;
  delayJitterMs: number;
  maxSubs: number;
  scrollRounds: number;
  deepReadMax: number;
  subBudgetMs: number;
}

export interface JobsRuntimeConfig {
  maxJobs: number;
  delayMs: number;
}

export interface ProductRuntimeConfig {
  lpBaseUrl: string;
}

/** block = force intensity 0; warn = allow but surface in HITL. */
export type PromoOnExceed = "block" | "warn";

export interface PromoRuntimeConfig {
  enabled: boolean;
  /** Max share of intensity ≥1 posts in the rolling window (0–1). */
  maxRatio: number;
  windowDays: number;
  onExceed: PromoOnExceed;
}

/** Poll live-posted comments for replies/removal; queue follow-up drafts. */
export interface PostWatchRuntimeConfig {
  enabled: boolean;
  minAgeHours: number;
  maxAgeHours: number;
  maxPerRun: number;
  followUpIntensity: 0 | 1 | 2;
}

/**
 * Resolved CommunityEngager runtime config (policy file + env secrets/overrides).
 * Nested to mirror `config/default.json`. Use {@link getCommunityConfig}.
 */
export interface CommunityRuntimeConfig {
  reddit: RedditSessionConfig;
  warmup: WarmupRuntimeConfig;
  promo: PromoRuntimeConfig;
  postWatch: PostWatchRuntimeConfig;
  discover: DiscoverRuntimeConfig;
  scout: ScoutRuntimeConfig;
  jobs: JobsRuntimeConfig;
  product: ProductRuntimeConfig;
}

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

export function parseWarmupMode(raw: string | undefined): WarmupMode {
  const v = (raw ?? "auto").trim().toLowerCase();
  if (v === "off" || v === "false" || v === "0" || v === "no") return "off";
  if (v === "force" || v === "true" || v === "1" || v === "yes" || v === "on") {
    return "force";
  }
  if (v === "auto") return "auto";
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
  cfg: CommunityRuntimeConfig
): "browser" | "oauth" | "none" {
  const { transport, oauthConfigured, hasUserPass } = cfg.reddit;
  if (transport === "browser") return "browser";
  if (transport === "oauth") return oauthConfigured ? "oauth" : "none";
  if (transport === "json" || transport === "fixtures") return "none";
  if (hasUserPass) return "browser";
  if (oauthConfigured) return "oauth";
  return "browser";
}

/**
 * Ordered write attempts for `auto` (and explicit transports as a one-item list).
 * Used so OAuth remains an optional fast path after browser failure.
 */
export function resolveWriteTransportChain(
  cfg: CommunityRuntimeConfig
): Array<"browser" | "oauth"> {
  const { transport, oauthConfigured } = cfg.reddit;
  if (transport === "browser") return ["browser"];
  if (transport === "oauth") return oauthConfigured ? ["oauth"] : [];
  if (transport === "json" || transport === "fixtures") return [];
  const chain: Array<"browser" | "oauth"> = ["browser"];
  if (oauthConfigured) chain.push("oauth");
  return chain;
}

export interface GetCommunityConfigOptions {
  /** Preloaded policy file (tests). */
  appConfig?: CommunityAppConfig;
}

/**
 * Resolve runtime config: secrets/paths from env; policy from
 * config/default.json → local.json, with env overrides when set.
 */
export function getCommunityConfig(
  env: NodeJS.ProcessEnv = process.env,
  opts: GetCommunityConfigOptions = {}
): CommunityRuntimeConfig {
  const policy = opts.appConfig ?? loadAppConfig();

  const clientId = env.REDDIT_CLIENT_ID;
  const clientSecret = env.REDDIT_CLIENT_SECRET;
  const username = env.REDDIT_USERNAME;
  const password = env.REDDIT_PASSWORD;
  const oauthConfigured = Boolean(
    clientId && clientSecret && username && password
  );
  const hasUserPass = Boolean(username && password);
  const dryRun = env.REDDIT_DRY_RUN !== "false" && env.REDDIT_DRY_RUN !== "0";

  const scoutSource = parseScoutSource(
    envString(env, "SCOUT_SOURCE", policy.scout.source)
  );
  const transport = parseTransport(env.REDDIT_TRANSPORT ?? "auto");

  const scoutDelayMs = envNumber(env, "REDDIT_SCOUT_DELAY_MS", policy.scout.delayMs);
  const scoutDelayJitterMs = envNumber(
    env,
    "REDDIT_SCOUT_DELAY_JITTER_MS",
    policy.scout.delayJitterMs
  );
  const scoutMaxSubs = envNumber(env, "REDDIT_SCOUT_MAX_SUBS", policy.scout.maxSubs);
  const scoutScrollRounds = envNumber(
    env,
    "REDDIT_SCOUT_SCROLL_ROUNDS",
    policy.scout.scrollRounds
  );
  const scoutDeepReadMax = envNumber(
    env,
    "REDDIT_SCOUT_DEEP_READ_MAX",
    policy.scout.deepReadMax
  );
  const scoutSubBudgetMs = envNumber(
    env,
    "REDDIT_SCOUT_SUB_BUDGET_MS",
    policy.scout.subBudgetMs,
    { min: 3000 }
  );

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

  const discoverMode = parseDiscoverMode(
    env.COMMUNITY_DISCOVER !== undefined && env.COMMUNITY_DISCOVER !== ""
      ? env.COMMUNITY_DISCOVER
      : policy.discover.mode
  );
  const minPostableFallback =
    policy.discover.minPostable ?? seedPostableCount();

  const warmupMode = parseWarmupMode(
    env.COMMUNITY_WARMUP !== undefined && env.COMMUNITY_WARMUP !== ""
      ? env.COMMUNITY_WARMUP
      : policy.warmup.mode
  );

  return {
    reddit: {
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
      transport,
      browserHeadless,
      interstitialHitl,
      dataDir,
      cookieDir,
    },
    warmup: {
      mode: warmupMode,
      minAccountDays: envNumber(
        env,
        "COMMUNITY_WARMUP_MIN_ACCOUNT_DAYS",
        policy.warmup.minAccountDays
      ),
      minKarma: envNumber(
        env,
        "COMMUNITY_WARMUP_MIN_KARMA",
        policy.warmup.minKarma
      ),
      minHelpComments: envNumber(
        env,
        "COMMUNITY_WARMUP_MIN_HELP_COMMENTS",
        policy.warmup.minHelpComments
      ),
    },
    promo: {
      enabled: envBool(env, "COMMUNITY_PROMO_ENABLED", policy.promo.enabled),
      maxRatio: (() => {
        const raw = env.COMMUNITY_PROMO_MAX_RATIO;
        if (raw === undefined || raw.trim() === "") return policy.promo.maxRatio;
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) return policy.promo.maxRatio;
        return n > 1 ? 1 : n;
      })(),
      windowDays: envNumber(
        env,
        "COMMUNITY_PROMO_WINDOW_DAYS",
        policy.promo.windowDays
      ),
      onExceed: (() => {
        const raw = env.COMMUNITY_PROMO_ON_EXCEED?.trim().toLowerCase();
        if (raw === "warn" || raw === "block") return raw;
        return policy.promo.onExceed === "warn" ? "warn" : "block";
      })(),
    },
    postWatch: {
      enabled: envBool(
        env,
        "COMMUNITY_POST_WATCH_ENABLED",
        policy.postWatch.enabled
      ),
      minAgeHours: envNumber(
        env,
        "COMMUNITY_POST_WATCH_MIN_AGE_HOURS",
        policy.postWatch.minAgeHours
      ),
      maxAgeHours: (() => {
        const minH = envNumber(
          env,
          "COMMUNITY_POST_WATCH_MIN_AGE_HOURS",
          policy.postWatch.minAgeHours
        );
        const maxH = envNumber(
          env,
          "COMMUNITY_POST_WATCH_MAX_AGE_HOURS",
          policy.postWatch.maxAgeHours
        );
        return Math.max(minH, maxH);
      })(),
      maxPerRun: envNumber(
        env,
        "COMMUNITY_POST_WATCH_MAX_PER_RUN",
        policy.postWatch.maxPerRun,
        { allowZero: false }
      ),
      followUpIntensity: (() => {
        const raw = env.COMMUNITY_POST_WATCH_FOLLOW_UP_INTENSITY;
        if (raw === undefined || raw.trim() === "") {
          return policy.postWatch.followUpIntensity;
        }
        const n = Number(raw);
        if (n === 2) return 2;
        if (n === 1) return 1;
        return 0;
      })(),
    },
    discover: {
      mode: discoverMode,
      enabled: discoverMode !== "off",
      query: envString(env, "COMMUNITY_DISCOVER_QUERY", policy.discover.query),
      maxCandidates: envNumber(
        env,
        "COMMUNITY_DISCOVER_MAX",
        policy.discover.maxCandidates,
        { allowZero: false }
      ),
      minPostable: envNumber(
        env,
        "COMMUNITY_DISCOVER_MIN_POSTABLE",
        minPostableFallback,
        { allowZero: false }
      ),
      exploreSlot: envBool(
        env,
        "COMMUNITY_DISCOVER_EXPLORE",
        policy.discover.exploreSlot
      ),
      goal: envString(env, "COMMUNITY_DISCOVER_GOAL", policy.discover.goal),
      requeueDays: envNumber(
        env,
        "COMMUNITY_DISCOVER_REQUEUE_DAYS",
        policy.discover.requeueDays
      ),
    },
    scout: {
      source: scoutSource,
      delayMs: scoutDelayMs,
      delayJitterMs: scoutDelayJitterMs,
      maxSubs: scoutMaxSubs,
      scrollRounds: scoutScrollRounds,
      deepReadMax: scoutDeepReadMax,
      subBudgetMs: scoutSubBudgetMs,
    },
    jobs: {
      maxJobs: envNumber(env, "COMMUNITY_MAX_JOBS", policy.jobs.maxJobs, {
        allowZero: false,
      }),
      delayMs: envNumber(env, "COMMUNITY_JOB_DELAY_MS", policy.jobs.delayMs),
    },
    product: {
      lpBaseUrl: envString(
        env,
        "GOSTYLENS_LP_BASE_URL",
        policy.product.lpBaseUrl
      ),
    },
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
    competition: false,
    icpFit: false,
    plugNaturalness: false,
  };
}
