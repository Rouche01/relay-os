import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Minimal KEY=VALUE loader (no dotenv dependency). Does not override existing env. */
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

/**
 * Load ACTION_STORE_* from a .env without requiring a manual export.
 * Relative ACTION_STORE_PATH is resolved against the env file's directory.
 */
export function loadActionStoreEnv(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const scriptDir = path.dirname(path.resolve(process.argv[1] ?? "."));
  const packageRoot = path.resolve(scriptDir, "..");

  const candidates = [
    env.ACTION_STORE_ENV_FILE,
    path.resolve(process.cwd(), ".env"),
    path.resolve(packageRoot, "../../apps/community-engager/.env"),
  ].filter((p): p is string => Boolean(p));

  let loadedFrom: string | undefined;
  for (const file of candidates) {
    const resolved = path.resolve(file);
    if (!existsSync(resolved)) continue;
    applyEnvFile(resolved, env);
    loadedFrom = resolved;
    break;
  }

  if (!loadedFrom) return undefined;
  const base = path.dirname(loadedFrom);

  for (const key of [
    "ACTION_STORE_PATH",
    "REDDIT_DATA_DIR",
    "COMMUNITY_RUNS_DIR",
  ] as const) {
    const raw = env[key]?.trim();
    if (raw && !path.isAbsolute(raw)) {
      env[key] = path.resolve(base, raw);
    }
  }

  return loadedFrom;
}
