import type { FeedbackRequest, FeedbackResponse } from "@relay/protocol";
import { pollComputerChallengeOnce } from "./computer-challenge.js";
import { getComputerChallengeSession } from "./computer-challenge-session.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * FeedbackBroker auto-resolver: poll the parked Computer Runtime desktop
 * until classify says feed (or forceRecheckPageClass in tests), then proceed.
 * Credential prompts are never auto-won — confirmation + login|interstitial only.
 *
 * With DECIDE_BACKEND=heuristic, recheck never auto-clears (no vision); human
 * Approve remains the reliable path. Jev / forcePageClass can clear on poll.
 */
export async function watchComputerChallengeCleared(
  request: FeedbackRequest,
  signal: AbortSignal
): Promise<FeedbackResponse> {
  const kind = request.context?.meta?.kind;
  const transport = request.context?.meta?.transport;
  const isComputerChallenge =
    request.type === "confirmation" &&
    (kind === "interstitial" || kind === "login") &&
    (transport === "computer" || Boolean(getComputerChallengeSession()));

  if (!isComputerChallenge) {
    return new Promise(() => undefined);
  }

  const pollMs = Number(process.env.REDDIT_INTERSTITIAL_POLL_MS ?? "2000");
  const interval = Number.isFinite(pollMs) && pollMs >= 500 ? pollMs : 2000;

  await sleep(Math.min(interval, 2500));

  let lastClass: string | undefined;
  while (!signal.aborted) {
    const session = getComputerChallengeSession();
    if (!session) {
      await sleep(interval);
      continue;
    }

    try {
      const once = await pollComputerChallengeOnce(session);
      if (once.clear) {
        console.log(
          "[computer:challenge] auto-detected clear on desktop — proceeding"
        );
        return {
          requestId: request.id,
          agentId: request.agentId,
          action: "proceed",
          value: true,
        };
      }
      const cls = once.decision.pageClass;
      if (cls !== lastClass) {
        lastClass = cls;
        console.log(
          `[computer:challenge] still blocked (${cls}) — polling every ${interval}ms`
        );
      }
    } catch (err) {
      console.warn("[computer:challenge] poll failed (will retry):", err);
    }

    await sleep(interval);
  }

  return new Promise(() => undefined);
}
