import path from "node:path";

/**
 * Community-engager data root (actions, allowlist, jobs, runs, cookies…).
 * Prefer REDDIT_DATA_DIR; else parent of ACTION_STORE_PATH; else cwd/.data.
 */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const fromReddit = env.REDDIT_DATA_DIR?.trim();
  if (fromReddit) return path.resolve(fromReddit);

  const storePath = env.ACTION_STORE_PATH?.trim();
  if (storePath) {
    const abs = path.resolve(storePath);
    const base = path.basename(abs);
    if (base === "actions.json" || base.endsWith(".json")) {
      return path.dirname(abs);
    }
    return abs;
  }

  return path.resolve(process.cwd(), ".data");
}

export function allowlistPath(dataDir: string): string {
  return path.join(dataDir, "allowlist", "subreddits.json");
}

export function jobsDir(dataDir: string): string {
  return path.join(dataDir, "jobs");
}

export function runsDir(env: NodeJS.ProcessEnv = process.env, dataDir?: string): string {
  if (env.COMMUNITY_RUNS_DIR?.trim()) {
    return path.resolve(env.COMMUNITY_RUNS_DIR.trim());
  }
  return path.join(dataDir ?? resolveDataDir(env), "runs");
}
