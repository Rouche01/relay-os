import type { PlaywrightEngine } from "@relay/engines-browser";

/**
 * In-process holder for a headed browser left open while HITL waits.
 * Kept off AgentContext so we don't put non-serializable handles in the bag.
 */
export interface InterstitialSession {
  engine: PlaywrightEngine;
  storagePath: string;
  url: string;
  subreddit: string;
  blockedSubs: string[];
}

let active: InterstitialSession | null = null;

export function setInterstitialSession(session: InterstitialSession): void {
  active = session;
}

export function getInterstitialSession(): InterstitialSession | null {
  return active;
}

/** Persist cookies without closing the headed window (post-CAPTCHA continue). */
export async function saveInterstitialCookies(): Promise<string | undefined> {
  const session = active;
  if (!session) return undefined;
  try {
    await session.engine.saveStorageState(session.storagePath);
    console.log(
      `[interstitial] saved cookie jar (window kept open) → ${session.storagePath}`
    );
    return session.storagePath;
  } catch (err) {
    console.warn("[interstitial] failed to save storageState:", err);
    return undefined;
  }
}

export async function clearInterstitialSession(
  save: boolean
): Promise<string | undefined> {
  const session = active;
  active = null;
  if (!session) return undefined;

  let savedPath: string | undefined;
  try {
    if (save) {
      await session.engine.saveStorageState(session.storagePath);
      savedPath = session.storagePath;
      console.log(
        `[interstitial] saved cookie jar after human pass → ${savedPath}`
      );
    }
  } catch (err) {
    console.warn("[interstitial] failed to save storageState:", err);
  } finally {
    try {
      await session.engine.teardown();
    } catch (err) {
      console.warn("[interstitial] teardown:", err);
    }
  }
  return savedPath;
}
