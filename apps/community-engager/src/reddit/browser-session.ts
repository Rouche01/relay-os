import { PlaywrightEngine } from "@relay/engines-browser";
import type { RedditEnvConfig } from "./config.js";
import { hasStorageState, loadStorageState, storageStatePath } from "./cookies.js";

/**
 * Default UA when env still has the placeholder bot string — www.reddit is
 * friendlier to a normal Chrome UA for anonymous listing.
 */
export function browserUserAgent(cfg: RedditEnvConfig): string {
  const ua = cfg.userAgent;
  if (!ua || /relay-community-engager/i.test(ua)) {
    return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
  }
  return ua;
}

export interface CreateRedditBrowserOptions {
  cfg: RedditEnvConfig;
  /**
   * When true (default), load storageState from cookieDir if present (AUTHED).
   * Login flows that refresh auth should set false and clear jar first.
   */
  useStoredSession?: boolean;
}

/**
 * Launch stealth Playwright with optional Reddit cookie jar (storageState).
 */
export async function createRedditBrowserEngine(
  opts: CreateRedditBrowserOptions
): Promise<{
  engine: PlaywrightEngine;
  sessionLoaded: boolean;
  storagePath: string;
}> {
  const { cfg, useStoredSession = true } = opts;
  const storagePath = storageStatePath(cfg);
  let sessionLoaded = false;
  let storageState: Awaited<ReturnType<typeof loadStorageState>> | undefined;

  if (useStoredSession && (await hasStorageState(cfg))) {
    storageState = await loadStorageState(cfg);
    sessionLoaded = Boolean(storageState);
    if (sessionLoaded) {
      console.log(`[browser] restored storageState from ${storagePath}`);
    }
  }

  const engine = new PlaywrightEngine({
    headless: cfg.browserHeadless,
    userAgent: browserUserAgent(cfg),
    storageState: storageState ?? undefined,
  });

  return { engine, sessionLoaded, storagePath };
}
