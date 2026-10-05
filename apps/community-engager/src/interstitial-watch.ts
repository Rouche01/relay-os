import type { FeedbackRequest, FeedbackResponse } from "@relay/protocol";
import { detectInterstitial } from "./reddit/interstitial.js";
import { getInterstitialSession } from "./reddit/interstitial-session.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Race helper for FeedbackBroker: poll the headed interstitial/login window
 * until the wall clears (or session looks logged-in), then auto-proceed.
 * Credential requests are owned by Telegram/CLI — this only races confirmations.
 */
export async function watchInterstitialCleared(
  request: FeedbackRequest,
  signal: AbortSignal
): Promise<FeedbackResponse> {
  const kind = request.context?.meta?.kind;
  const isChallengeConfirm =
    request.type === "confirmation" &&
    (kind === "interstitial" || kind === "login");

  if (!isChallengeConfirm) {
    // Never win the race for unrelated feedback (esp. credential prompts).
    return new Promise(() => undefined);
  }

  const pollMs = Number(process.env.REDDIT_INTERSTITIAL_POLL_MS ?? "2000");
  const interval = Number.isFinite(pollMs) && pollMs >= 500 ? pollMs : 2000;

  // Give the human a moment before first check (page may still be loading).
  await sleep(Math.min(interval, 2500));

  let lastReason: string | undefined;
  while (!signal.aborted) {
    const session = getInterstitialSession();
    if (!session) {
      await sleep(interval);
      continue;
    }

    try {
      const page = await session.engine.getPage();
      // Stale navigation / closed page — keep waiting for adapter.
      const wall = await detectInterstitial(page);
      if (!wall.challenged) {
        console.log(
          "[interstitial] auto-detected clear in headed browser — proceeding"
        );
        return {
          requestId: request.id,
          agentId: request.agentId,
          action: "proceed",
          value: true,
        };
      }
      if (wall.reason && wall.reason !== lastReason) {
        lastReason = wall.reason;
        console.log(
          `[interstitial] still blocked (${wall.reason}) — polling every ${interval}ms`
        );
      }
    } catch (err) {
      console.warn("[interstitial] poll failed (will retry):", err);
    }

    await sleep(interval);
  }

  return new Promise(() => undefined);
}
