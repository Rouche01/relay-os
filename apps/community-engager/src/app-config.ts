import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { DiscoverMode, ScoutSource, WarmupMode } from "./reddit/config.js";

/**
 * Policy config for CommunityEngager (not secrets).
 * Load order: config/default.json → config/local.json → env overrides in getCommunityConfig.
 */

export interface WarmupFileConfig {
  mode?: WarmupMode | string;
  minAccountDays?: number;
  minKarma?: number;
  minHelpComments?: number;
}

export interface DiscoverFileConfig {
  mode?: DiscoverMode | string;
  query?: string;
  maxCandidates?: number;
  /** null = use seed allowlist size at runtime */
  minPostable?: number | null;
  exploreSlot?: boolean;
  goal?: string;
  requeueDays?: number;
}

export interface ScoutFileConfig {
  source?: ScoutSource | string;
  delayMs?: number;
  delayJitterMs?: number;
  maxSubs?: number;
  scrollRounds?: number;
  deepReadMax?: number;
  subBudgetMs?: number;
}

export interface JobsFileConfig {
  maxJobs?: number;
  delayMs?: number;
}

export interface ProductFileConfig {
  lpBaseUrl?: string;
}

export interface DraftFileConfig {
  /** Reserved for future draft/intensity policy. */
  [key: string]: unknown;
}

export interface PromoFileConfig {
  enabled?: boolean;
  /** Max share of intensity ≥1 posts in the rolling window (0–1). Default 0.1. */
  maxRatio?: number;
  windowDays?: number;
  /** block = force intensity 0; warn = allow but surface in HITL. */
  onExceed?: "block" | "warn";
}

export interface PostWatchFileConfig {
  enabled?: boolean;
  /** Hours after post before first check. Default 24. */
  minAgeHours?: number;
  /** Stop polling after this many hours. Default 72. */
  maxAgeHours?: number;
  /** Max watches to poll per parent run. Default 10. */
  maxPerRun?: number;
  /** Intensity for queued follow-up drafts (usually 0). */
  followUpIntensity?: 0 | 1 | 2;
}

export interface CadenceFileConfig {
  enabled?: boolean;
  /** Max intensity-0 live posts per local calendar day. Default 5. */
  maxHelpPerDay?: number;
  /** Max intensity ≥1 live posts per local calendar day. Default 1. */
  maxPromoPerDay?: number;
}

export interface VisibilityFileConfig {
  enabled?: boolean;
  /** Wait before logged-out permalink fetch (ms). Default 3000. */
  delayMs?: number;
}

export interface CommunityAppConfig {
  warmup: Required<
    Pick<WarmupFileConfig, "mode" | "minAccountDays" | "minKarma" | "minHelpComments">
  >;
  promo: {
    enabled: boolean;
    maxRatio: number;
    windowDays: number;
    onExceed: "block" | "warn";
  };
  postWatch: {
    enabled: boolean;
    minAgeHours: number;
    maxAgeHours: number;
    maxPerRun: number;
    followUpIntensity: 0 | 1 | 2;
  };
  cadence: {
    enabled: boolean;
    maxHelpPerDay: number;
    maxPromoPerDay: number;
  };
  visibility: {
    enabled: boolean;
    delayMs: number;
  };
  discover: {
    mode: string;
    query: string;
    maxCandidates: number;
    minPostable: number | null;
    exploreSlot: boolean;
    goal: string;
    requeueDays: number;
  };
  scout: {
    source: string;
    delayMs: number;
    delayJitterMs: number;
    maxSubs: number;
    scrollRounds: number;
    deepReadMax: number;
    subBudgetMs: number;
  };
  jobs: {
    maxJobs: number;
    delayMs: number;
  };
  product: {
    lpBaseUrl: string;
  };
  draft: DraftFileConfig;
}

export interface LoadAppConfigOptions {
  /** Override config directory (tests). */
  configDir?: string;
  /** Bypass module cache. */
  forceReload?: boolean;
  /** Extra overlay (e.g. test fixture) merged after local.json. */
  overlay?: Partial<CommunityAppConfigFile>;
}

/** Raw JSON shape before defaults are filled. */
export interface CommunityAppConfigFile {
  warmup?: WarmupFileConfig;
  promo?: PromoFileConfig;
  postWatch?: PostWatchFileConfig;
  cadence?: CadenceFileConfig;
  visibility?: VisibilityFileConfig;
  discover?: DiscoverFileConfig;
  scout?: ScoutFileConfig;
  jobs?: JobsFileConfig;
  product?: ProductFileConfig;
  draft?: DraftFileConfig;
}

const BUILTIN_DEFAULTS: CommunityAppConfig = {
  warmup: {
    mode: "auto",
    minAccountDays: 30,
    minKarma: 100,
    minHelpComments: 10,
  },
  promo: {
    enabled: true,
    maxRatio: 0.1,
    windowDays: 30,
    onExceed: "block",
  },
  postWatch: {
    enabled: true,
    minAgeHours: 24,
    maxAgeHours: 72,
    maxPerRun: 10,
    followUpIntensity: 0,
  },
  cadence: {
    enabled: true,
    maxHelpPerDay: 5,
    maxPromoPerDay: 1,
  },
  visibility: {
    enabled: true,
    delayMs: 3000,
  },
  discover: {
    mode: "auto",
    query: "fashion style advice wardrobe",
    maxCandidates: 5,
    minPostable: null,
    exploreSlot: true,
    goal: "Help-first fashion and styling communities for GoStylens. Soft product mention OK when useful; never hard-sell or spam.",
    requeueDays: 14,
  },
  scout: {
    source: "auto",
    delayMs: 8000,
    delayJitterMs: 4000,
    maxSubs: 0,
    scrollRounds: 4,
    deepReadMax: 5,
    subBudgetMs: 45_000,
  },
  jobs: {
    maxJobs: 3,
    delayMs: 1500,
  },
  product: {
    lpBaseUrl: "https://gostylens.app",
  },
  draft: {},
};

let cached: CommunityAppConfig | null = null;
let cachedDir: string | null = null;

/** Clear cached policy config (tests). */
export function resetAppConfigCache(): void {
  cached = null;
  cachedDir = null;
}

/**
 * Resolve the directory that holds default.json / local.json.
 * Prefer COMMUNITY_CONFIG_DIR, then cwd/config, then package config/.
 */
export function resolveConfigDir(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
): string {
  const fromEnv = env.COMMUNITY_CONFIG_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);

  const cwdConfig = path.resolve(cwd, "config");
  if (existsSync(path.join(cwdConfig, "default.json"))) return cwdConfig;

  // Compiled to CJS (package has no "type":"module") — __dirname is dist/ or dist-test/src/.
  const here = __dirname;
  const candidates = [
    path.resolve(here, "..", "config"), // dist/ → ../config
    path.resolve(here, "..", "..", "config"), // dist-test/src → ../../config
  ];
  for (const dir of candidates) {
    if (existsSync(path.join(dir, "default.json"))) return dir;
  }
  return cwdConfig;
}

export function loadAppConfig(
  opts: LoadAppConfigOptions = {}
): CommunityAppConfig {
  const configDir = opts.configDir ?? resolveConfigDir();
  if (
    !opts.forceReload &&
    !opts.overlay &&
    cached &&
    cachedDir === configDir
  ) {
    return cached;
  }

  const fileDefault = readJsonFile(
    path.join(configDir, "default.json")
  ) as CommunityAppConfigFile | null;
  const fileLocal = readJsonFile(
    path.join(configDir, "local.json")
  ) as CommunityAppConfigFile | null;

  const merged = mergeConfig(
    BUILTIN_DEFAULTS,
    fileDefault,
    fileLocal,
    opts.overlay
  );

  if (!opts.overlay) {
    cached = merged;
    cachedDir = configDir;
  }
  return merged;
}

export function mergeConfig(
  ...layers: Array<CommunityAppConfig | CommunityAppConfigFile | null | undefined>
): CommunityAppConfig {
  let out: CommunityAppConfig = structuredClone(BUILTIN_DEFAULTS);
  for (const layer of layers) {
    if (!layer) continue;
    out = {
      warmup: { ...out.warmup, ...pickDefined(layer.warmup) },
      promo: {
        ...out.promo,
        ...pickDefined(layer.promo),
        onExceed: parseOnExceed(
          layer.promo?.onExceed ?? out.promo.onExceed
        ),
      },
      postWatch: {
        ...out.postWatch,
        ...pickDefined(layer.postWatch),
        followUpIntensity: parseFollowUpIntensity(
          layer.postWatch?.followUpIntensity ?? out.postWatch.followUpIntensity
        ),
      },
      cadence: { ...out.cadence, ...pickDefined(layer.cadence) },
      visibility: { ...out.visibility, ...pickDefined(layer.visibility) },
      discover: { ...out.discover, ...pickDefined(layer.discover) },
      scout: { ...out.scout, ...pickDefined(layer.scout) },
      jobs: { ...out.jobs, ...pickDefined(layer.jobs) },
      product: { ...out.product, ...pickDefined(layer.product) },
      draft: { ...out.draft, ...pickDefined(layer.draft) },
    };
  }
  return normalizeConfig(out);
}

function normalizeConfig(raw: CommunityAppConfig): CommunityAppConfig {
  const minAge = nonNegInt(raw.postWatch?.minAgeHours, 24);
  const maxAge = nonNegInt(raw.postWatch?.maxAgeHours, 72);
  return {
    warmup: {
      mode: String(raw.warmup.mode ?? "auto"),
      minAccountDays: nonNegInt(raw.warmup.minAccountDays, 30),
      minKarma: nonNegInt(raw.warmup.minKarma, 100),
      minHelpComments: nonNegInt(raw.warmup.minHelpComments, 10),
    },
    promo: {
      enabled: Boolean(raw.promo?.enabled ?? true),
      maxRatio: clampRatio(raw.promo?.maxRatio, 0.1),
      windowDays: nonNegInt(raw.promo?.windowDays, 30),
      onExceed: parseOnExceed(raw.promo?.onExceed),
    },
    postWatch: {
      enabled: Boolean(raw.postWatch?.enabled ?? true),
      minAgeHours: minAge,
      maxAgeHours: Math.max(minAge, maxAge),
      maxPerRun: positiveInt(raw.postWatch?.maxPerRun, 10),
      followUpIntensity: parseFollowUpIntensity(
        raw.postWatch?.followUpIntensity
      ),
    },
    cadence: {
      enabled: Boolean(raw.cadence?.enabled ?? true),
      maxHelpPerDay: nonNegInt(raw.cadence?.maxHelpPerDay, 5),
      maxPromoPerDay: nonNegInt(raw.cadence?.maxPromoPerDay, 1),
    },
    visibility: {
      enabled: Boolean(raw.visibility?.enabled ?? true),
      delayMs: nonNegInt(raw.visibility?.delayMs, 3000),
    },
    discover: {
      mode: String(raw.discover.mode ?? "auto"),
      query: String(raw.discover.query ?? BUILTIN_DEFAULTS.discover.query),
      maxCandidates: positiveInt(raw.discover.maxCandidates, 5),
      minPostable:
        raw.discover.minPostable == null
          ? null
          : positiveInt(raw.discover.minPostable, 1),
      exploreSlot: Boolean(raw.discover.exploreSlot),
      goal: String(raw.discover.goal ?? BUILTIN_DEFAULTS.discover.goal),
      requeueDays: nonNegInt(raw.discover.requeueDays, 14),
    },
    scout: {
      source: String(raw.scout.source ?? "auto"),
      delayMs: nonNegInt(raw.scout.delayMs, 8000),
      delayJitterMs: nonNegInt(raw.scout.delayJitterMs, 4000),
      maxSubs: nonNegInt(raw.scout.maxSubs, 0),
      scrollRounds: nonNegInt(raw.scout.scrollRounds, 4),
      deepReadMax: nonNegInt(raw.scout.deepReadMax, 5),
      subBudgetMs: Math.max(3000, nonNegInt(raw.scout.subBudgetMs, 45_000)),
    },
    jobs: {
      maxJobs: positiveInt(raw.jobs.maxJobs, 3),
      delayMs: nonNegInt(raw.jobs.delayMs, 1500),
    },
    product: {
      lpBaseUrl: String(
        raw.product.lpBaseUrl ?? BUILTIN_DEFAULTS.product.lpBaseUrl
      ),
    },
    draft: raw.draft ?? {},
  };
}

function pickDefined<T extends object>(obj: T | undefined): Partial<T> {
  if (!obj || typeof obj !== "object") return {};
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k.startsWith("_")) continue;
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function readJsonFile(filePath: string): unknown | null {
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw) as unknown;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[app-config] failed to read ${filePath}: ${message}`);
    return null;
  }
}

function nonNegInt(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function positiveInt(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function clampRatio(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  if (n > 1) return 1;
  return n;
}

function parseOnExceed(raw: unknown): "block" | "warn" {
  const v = String(raw ?? "block").trim().toLowerCase();
  return v === "warn" ? "warn" : "block";
}

function parseFollowUpIntensity(raw: unknown): 0 | 1 | 2 {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (n === 2) return 2;
  if (n === 1) return 1;
  return 0;
}

/** Env wins when the variable is set (non-empty). */
export function envString(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: string
): string {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw.trim();
}

export function envNumber(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  opts?: { min?: number; allowZero?: boolean }
): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const min = opts?.min ?? (opts?.allowZero === false ? 1 : 0);
  if (n < min) return fallback;
  return Math.floor(n);
}

export function envBool(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: boolean
): boolean {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (v === "false" || v === "0" || v === "no" || v === "off") return false;
  if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
  return fallback;
}
