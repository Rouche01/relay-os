import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getCommunityConfig,
  type CommunityRuntimeConfig,
  type WarmupMode,
} from "../reddit/config.js";
import { RedditClient } from "../reddit/client.js";

export interface WarmupThresholds {
  minAccountDays: number;
  minKarma: number;
  minHelpComments: number;
}

export interface WarmupAccountSnapshot {
  /** Reddit account created_utc (seconds). */
  createdUtc?: number;
  totalKarma?: number;
  /** Where the snapshot came from. */
  source: "oauth" | "env" | "unknown";
  fetchedAt?: string;
}

export interface WarmupStateFile {
  helpCommentsPosted: number;
  updatedAt: string;
  account?: WarmupAccountSnapshot;
}

export interface WarmupEvalInput {
  mode: WarmupMode;
  thresholds: WarmupThresholds;
  helpCommentsPosted: number;
  account: WarmupAccountSnapshot;
  /** Optional clock for tests. */
  nowMs?: number;
}

export interface WarmupStatus {
  active: boolean;
  mode: WarmupMode;
  reasons: string[];
  thresholds: WarmupThresholds;
  helpCommentsPosted: number;
  accountDays?: number;
  totalKarma?: number;
  /** True when account age/karma could not be measured. */
  accountStatsUnknown: boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function warmupStatePath(dataDir: string): string {
  return path.join(dataDir, "warmup", "state.json");
}

export async function readWarmupState(dataDir: string): Promise<WarmupStateFile> {
  const file = warmupStatePath(dataDir);
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<WarmupStateFile>;
    const help = Number(parsed.helpCommentsPosted ?? 0);
    return {
      helpCommentsPosted:
        Number.isFinite(help) && help >= 0 ? Math.floor(help) : 0,
      updatedAt:
        typeof parsed.updatedAt === "string"
          ? parsed.updatedAt
          : new Date(0).toISOString(),
      account: normalizeAccountSnapshot(parsed.account),
    };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return {
        helpCommentsPosted: 0,
        updatedAt: new Date(0).toISOString(),
      };
    }
    throw err;
  }
}

export async function writeWarmupState(
  dataDir: string,
  state: WarmupStateFile
): Promise<void> {
  const file = warmupStatePath(dataDir);
  await mkdir(path.dirname(file), { recursive: true });
  const next: WarmupStateFile = {
    ...state,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

/**
 * Increment local help-comment counter after a live intensity-0 post.
 * Returns the new total.
 */
export async function recordHelpCommentPosted(
  dataDir: string
): Promise<number> {
  const state = await readWarmupState(dataDir);
  state.helpCommentsPosted += 1;
  await writeWarmupState(dataDir, state);
  return state.helpCommentsPosted;
}

export function accountDaysSince(
  createdUtc: number,
  nowMs = Date.now()
): number {
  if (!Number.isFinite(createdUtc) || createdUtc <= 0) return 0;
  const ageMs = Math.max(0, nowMs - createdUtc * 1000);
  return Math.floor(ageMs / MS_PER_DAY);
}

/**
 * Pure evaluation: warmup is active in `force`, off in `off`, and in `auto`
 * until every *known* threshold is met. Unknown account age/karma do not block
 * exit by themselves (browser-only setups); help-comment count always applies.
 */
export function evaluateWarmup(input: WarmupEvalInput): WarmupStatus {
  const { mode, thresholds, helpCommentsPosted, account } = input;
  const nowMs = input.nowMs ?? Date.now();
  const reasons: string[] = [];

  if (mode === "off") {
    return {
      active: false,
      mode,
      reasons: [],
      thresholds,
      helpCommentsPosted,
      accountStatsUnknown: account.source === "unknown",
    };
  }

  if (mode === "force") {
    return {
      active: true,
      mode,
      reasons: ["COMMUNITY_WARMUP=force"],
      thresholds,
      helpCommentsPosted,
      accountDays:
        account.createdUtc != null
          ? accountDaysSince(account.createdUtc, nowMs)
          : undefined,
      totalKarma: account.totalKarma,
      accountStatsUnknown: account.source === "unknown",
    };
  }

  // auto
  let accountDays: number | undefined;
  if (account.createdUtc != null) {
    accountDays = accountDaysSince(account.createdUtc, nowMs);
    if (accountDays < thresholds.minAccountDays) {
      reasons.push(
        `account age ${accountDays}d < ${thresholds.minAccountDays}d`
      );
    }
  }

  let totalKarma: number | undefined;
  if (account.totalKarma != null) {
    totalKarma = account.totalKarma;
    if (totalKarma < thresholds.minKarma) {
      reasons.push(`karma ${totalKarma} < ${thresholds.minKarma}`);
    }
  }

  if (helpCommentsPosted < thresholds.minHelpComments) {
    reasons.push(
      `help comments ${helpCommentsPosted} < ${thresholds.minHelpComments}`
    );
  }

  return {
    active: reasons.length > 0,
    mode,
    reasons,
    thresholds,
    helpCommentsPosted,
    accountDays,
    totalKarma,
    accountStatsUnknown: account.source === "unknown",
  };
}

export function resolveEnvAccountSnapshot(
  env: NodeJS.ProcessEnv = process.env
): WarmupAccountSnapshot | undefined {
  const createdRaw = env.COMMUNITY_WARMUP_ACCOUNT_CREATED_AT?.trim();
  const karmaRaw = env.COMMUNITY_WARMUP_KARMA?.trim();
  let createdUtc: number | undefined;
  if (createdRaw) {
    if (/^\d+$/.test(createdRaw)) {
      const n = Number(createdRaw);
      // Accept seconds or ms
      createdUtc = n > 1e12 ? Math.floor(n / 1000) : n;
    } else {
      const ms = Date.parse(createdRaw);
      if (Number.isFinite(ms)) createdUtc = Math.floor(ms / 1000);
    }
  }
  let totalKarma: number | undefined;
  if (karmaRaw) {
    const k = Number(karmaRaw);
    if (Number.isFinite(k) && k >= 0) totalKarma = Math.floor(k);
  }
  if (createdUtc == null && totalKarma == null) return undefined;
  return { createdUtc, totalKarma, source: "env" };
}

/**
 * Load state, merge env/oauth account snapshot, evaluate warmup.
 * OAuth `/api/v1/me` is best-effort when configured.
 */
export async function resolveWarmupStatus(
  cfg: CommunityRuntimeConfig = getCommunityConfig(),
  opts?: { nowMs?: number; fetchAccount?: boolean }
): Promise<WarmupStatus> {
  const state = await readWarmupState(cfg.reddit.dataDir);
  let account =
    resolveEnvAccountSnapshot(process.env) ??
    state.account ??
    ({ source: "unknown" } satisfies WarmupAccountSnapshot);

  const shouldFetch =
    opts?.fetchAccount !== false &&
    cfg.warmup.mode !== "off" &&
    cfg.reddit.oauthConfigured &&
    account.source !== "env";

  if (shouldFetch) {
    try {
      const client = new RedditClient(cfg.reddit);
      const me = await client.fetchMe();
      account = {
        createdUtc: me.createdUtc,
        totalKarma: me.totalKarma,
        source: "oauth",
        fetchedAt: new Date().toISOString(),
      };
      await writeWarmupState(cfg.reddit.dataDir, {
        ...state,
        account,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[warmup] oauth /api/v1/me failed: ${message}`);
    }
  }

  return evaluateWarmup({
    mode: cfg.warmup.mode,
    thresholds: {
      minAccountDays: cfg.warmup.minAccountDays,
      minKarma: cfg.warmup.minKarma,
      minHelpComments: cfg.warmup.minHelpComments,
    },
    helpCommentsPosted: state.helpCommentsPosted,
    account,
    nowMs: opts?.nowMs,
  });
}

export function formatWarmupLog(status: WarmupStatus): string {
  if (!status.active) {
    const bits = [
      `mode=${status.mode}`,
      `help=${status.helpCommentsPosted}/${status.thresholds.minHelpComments}`,
    ];
    if (status.accountDays != null) {
      bits.push(`age=${status.accountDays}d/${status.thresholds.minAccountDays}d`);
    }
    if (status.totalKarma != null) {
      bits.push(`karma=${status.totalKarma}/${status.thresholds.minKarma}`);
    }
    return `[warmup] inactive (${bits.join(" ")})`;
  }
  return `[warmup] ACTIVE — force intensity 0 (${status.reasons.join("; ")})`;
}

function normalizeAccountSnapshot(
  raw: WarmupStateFile["account"] | undefined
): WarmupAccountSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const source =
    raw.source === "oauth" || raw.source === "env" || raw.source === "unknown"
      ? raw.source
      : "unknown";
  return {
    createdUtc:
      typeof raw.createdUtc === "number" && Number.isFinite(raw.createdUtc)
        ? raw.createdUtc
        : undefined,
    totalKarma:
      typeof raw.totalKarma === "number" && Number.isFinite(raw.totalKarma)
        ? raw.totalKarma
        : undefined,
    source,
    fetchedAt: typeof raw.fetchedAt === "string" ? raw.fetchedAt : undefined,
  };
}
