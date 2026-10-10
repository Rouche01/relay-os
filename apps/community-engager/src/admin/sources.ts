import path from "node:path";
import type { SourceConfig } from "@relay/admin-shell";

/**
 * Resolve independent file locations for each admin collection.
 * Runs may live outside the app data root (COMMUNITY_RUNS_DIR).
 */
export function resolveDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.REDDIT_DATA_DIR?.trim()) {
    return path.resolve(env.REDDIT_DATA_DIR.trim());
  }
  if (env.ACTION_STORE_PATH?.trim()) {
    const abs = path.resolve(env.ACTION_STORE_PATH.trim());
    if (path.basename(abs).endsWith(".json")) return path.dirname(abs);
    return abs;
  }
  return path.resolve(process.cwd(), ".data");
}

export function actionsSource(env: NodeJS.ProcessEnv = process.env): SourceConfig {
  return {
    driver: "file",
    path:
      env.ACTION_STORE_PATH?.trim() ||
      path.join(resolveDataRoot(env), "actions.json"),
  };
}

export function allowlistSource(env: NodeJS.ProcessEnv = process.env): SourceConfig {
  return {
    driver: "file",
    path:
      env.ALLOWLIST_PATH?.trim() ||
      path.join(resolveDataRoot(env), "allowlist", "subreddits.json"),
  };
}

export function jobsSource(env: NodeJS.ProcessEnv = process.env): SourceConfig {
  return {
    driver: "file",
    path: env.JOBS_DIR?.trim() || path.join(resolveDataRoot(env), "jobs"),
  };
}

export function runsSource(env: NodeJS.ProcessEnv = process.env): SourceConfig {
  return {
    driver: "file",
    path:
      env.COMMUNITY_RUNS_DIR?.trim() || path.join(resolveDataRoot(env), "runs"),
  };
}

export function assertFileSource(source: SourceConfig, label: string): asserts source is {
  driver: "file";
  path: string;
} {
  if (source.driver !== "file") {
    throw new Error(
      `${label}: driver "${source.driver}" is not implemented yet; use file`
    );
  }
}
