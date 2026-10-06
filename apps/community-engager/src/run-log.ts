import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RunSummary } from "./job-queue.js";

export const RUN_LOG_SCHEMA_VERSION = 1 as const;

export interface RunLogMeta {
  /** Wall-clock start (ISO). */
  startedAt: string;
  agentId?: string;
  sessionId?: string;
  /** Memory backend name when known. */
  memoryName?: string;
  memoryHealthy?: boolean;
}

export interface RunLogRecord {
  schemaVersion: typeof RUN_LOG_SCHEMA_VERSION;
  runId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  app: "community-engager";
  appVersion: string;
  agentId?: string;
  sessionId?: string;
  /** VoltMem tenant (not a secret). */
  tenantId?: string;
  feedbackAdapter?: string;
  memory?: { name?: string; healthy?: boolean };
  /** Safe env snapshot — no tokens, passwords, or API keys. */
  flags: Record<string, string | number | boolean | undefined>;
  summary: RunSummary;
}

function envFlag(name: string): string | undefined {
  const v = process.env[name];
  if (v === undefined || v === "") return undefined;
  return v;
}

function boolEnv(name: string): boolean | undefined {
  const v = envFlag(name)?.toLowerCase();
  if (v === undefined) return undefined;
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return undefined;
}

/** Non-secret knobs useful when replaying a run later. */
export function collectSafeRunFlags(): Record<
  string,
  string | number | boolean | undefined
> {
  const maxJobs = Number(process.env.COMMUNITY_MAX_JOBS);
  const jobDelay = Number(process.env.COMMUNITY_JOB_DELAY_MS);
  return {
    feedbackAdapter: envFlag("FEEDBACK_ADAPTER") ?? "cli",
    scoutSource: envFlag("SCOUT_SOURCE"),
    redditTransport: envFlag("REDDIT_TRANSPORT"),
    redditDryRun: boolEnv("REDDIT_DRY_RUN"),
    redditBrowserHeadless: boolEnv("REDDIT_BROWSER_HEADLESS"),
    redditInterstitialHitl: boolEnv("REDDIT_INTERSTITIAL_HITL"),
    communityDiscover: boolEnv("COMMUNITY_DISCOVER"),
    maxJobs: Number.isFinite(maxJobs) && maxJobs > 0 ? maxJobs : undefined,
    jobDelayMs: Number.isFinite(jobDelay) && jobDelay >= 0 ? jobDelay : undefined,
  };
}

export function resolveRunsDir(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const raw = (env.COMMUNITY_RUN_LOG ?? "1").trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(raw)) return null;

  if (env.COMMUNITY_RUNS_DIR?.trim()) {
    return path.resolve(env.COMMUNITY_RUNS_DIR.trim());
  }
  if (env.REDDIT_DATA_DIR?.trim()) {
    return path.resolve(env.REDDIT_DATA_DIR.trim(), "runs");
  }
  return path.resolve(process.cwd(), ".data", "runs");
}

function stampFileName(endedAt: Date, runId: string): string {
  const iso = endedAt.toISOString().replace(/[:.]/g, "-");
  return `${iso}-${runId.slice(0, 8)}.json`;
}

/**
 * Persist a structured per-run summary for later analysis.
 * Returns the file path, or null when logging is disabled / write failed (fail-open).
 */
export async function writeRunLog(
  summary: RunSummary,
  meta: RunLogMeta,
  env: NodeJS.ProcessEnv = process.env
): Promise<string | null> {
  const dir = resolveRunsDir(env);
  if (!dir) return null;

  const endedAt = new Date();
  const started = new Date(meta.startedAt);
  const runId = randomUUID();
  const tenantId =
    env.VOLTMEM_TENANT_ID?.trim() ||
    env.VOLTMEM_USER_ID?.trim() ||
    undefined;

  const record: RunLogRecord = {
    schemaVersion: RUN_LOG_SCHEMA_VERSION,
    runId,
    startedAt: meta.startedAt,
    endedAt: endedAt.toISOString(),
    durationMs: Math.max(0, endedAt.getTime() - started.getTime()),
    app: "community-engager",
    appVersion: "0.1.0",
    agentId: meta.agentId,
    sessionId: meta.sessionId,
    tenantId,
    feedbackAdapter: env.FEEDBACK_ADAPTER?.trim() || "cli",
    memory:
      meta.memoryName !== undefined || meta.memoryHealthy !== undefined
        ? { name: meta.memoryName, healthy: meta.memoryHealthy }
        : undefined,
    flags: collectSafeRunFlags(),
    summary,
  };

  const filePath = path.join(dir, stampFileName(endedAt, runId));
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    return filePath;
  } catch (err) {
    console.warn(
      "[run-log] failed to write (fail-open):",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
