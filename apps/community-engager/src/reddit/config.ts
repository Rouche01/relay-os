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
  /** Delay between allowlisted subs during browser scout (ms). */
  scoutDelayMs: number;
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

  const delayRaw = Number(env.REDDIT_SCOUT_DELAY_MS ?? "1500");
  const scoutDelayMs =
    Number.isFinite(delayRaw) && delayRaw >= 0 ? delayRaw : 1500;

  const budgetRaw = Number(env.REDDIT_SCOUT_SUB_BUDGET_MS ?? "12000");
  const scoutSubBudgetMs =
    Number.isFinite(budgetRaw) && budgetRaw >= 3000 ? budgetRaw : 12_000;

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
    scoutSubBudgetMs,
    interstitialHitl,
    dataDir,
    cookieDir,
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
