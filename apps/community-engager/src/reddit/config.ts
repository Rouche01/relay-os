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

export interface RedditEnvConfig {
  clientId?: string;
  clientSecret?: string;
  username?: string;
  password?: string;
  userAgent: string;
  configured: boolean;
  /** When true (default), never call write APIs. */
  dryRun: boolean;
  /** fixtures | reddit | auto */
  scoutSource: "fixtures" | "reddit" | "auto";
  lpBaseUrl: string;
}

export function getRedditEnv(
  env: NodeJS.ProcessEnv = process.env
): RedditEnvConfig {
  const clientId = env.REDDIT_CLIENT_ID;
  const clientSecret = env.REDDIT_CLIENT_SECRET;
  const username = env.REDDIT_USERNAME;
  const password = env.REDDIT_PASSWORD;
  const configured = Boolean(clientId && clientSecret && username && password);
  const dryRun = env.REDDIT_DRY_RUN !== "false" && env.REDDIT_DRY_RUN !== "0";
  const rawSource = (env.SCOUT_SOURCE ?? "auto").toLowerCase();
  const scoutSource =
    rawSource === "reddit" || rawSource === "fixtures" ? rawSource : "auto";

  return {
    clientId,
    clientSecret,
    username,
    password,
    userAgent: env.REDDIT_USER_AGENT ?? "relay-community-engager/0.1 by relay-os",
    configured,
    dryRun,
    scoutSource,
    lpBaseUrl: env.GOSTYLENS_LP_BASE_URL ?? "https://gostylens.app",
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
