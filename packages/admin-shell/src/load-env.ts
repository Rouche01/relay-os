import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Minimal KEY=VALUE loader. Does not override existing env. */
function applyEnvFile(filePath: string, env: NodeJS.ProcessEnv): void {
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
}

export interface LoadEnvOptions {
  /** Extra candidate .env paths (after ACTION_STORE_ENV_FILE / cwd). */
  candidates?: string[];
  /** Keys whose relative values resolve against the env file directory. */
  pathKeys?: string[];
}

const DEFAULT_PATH_KEYS = [
  "ACTION_STORE_PATH",
  "REDDIT_DATA_DIR",
  "COMMUNITY_RUNS_DIR",
  "ALLOWLIST_PATH",
  "JOBS_DIR",
];

/**
 * Load the first existing .env from candidates.
 * Relative path keys are resolved against that file's directory.
 */
export function loadAdminEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: LoadEnvOptions = {}
): string | undefined {
  const list = [
    env.ACTION_STORE_ENV_FILE,
    env.ADMIN_ENV_FILE,
    path.resolve(process.cwd(), ".env"),
    ...(options.candidates ?? []),
  ].filter((p): p is string => Boolean(p));

  let loadedFrom: string | undefined;
  for (const file of list) {
    const resolved = path.resolve(file);
    if (!existsSync(resolved)) continue;
    applyEnvFile(resolved, env);
    loadedFrom = resolved;
    break;
  }

  if (!loadedFrom) return undefined;
  const base = path.dirname(loadedFrom);
  const pathKeys = options.pathKeys ?? DEFAULT_PATH_KEYS;
  for (const key of pathKeys) {
    const raw = env[key]?.trim();
    if (raw && !path.isAbsolute(raw)) {
      env[key] = path.resolve(base, raw);
    }
  }

  return loadedFrom;
}
