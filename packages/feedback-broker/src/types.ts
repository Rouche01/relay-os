import type { FeedbackRequest, FeedbackResponse } from "@relay/protocol";

/**
 * Channel that presents a FeedbackRequest to a human and returns their reply.
 * Telegram, CLI, web, etc. all implement this.
 */
export interface FeedbackAdapter {
  readonly name: string;
  present(request: FeedbackRequest): Promise<FeedbackResponse>;
  /**
   * Optional: settle an in-flight `present` early (e.g. page auto-detected clear).
   * Adapters that ignore this leave the human prompt hanging until timeout.
   */
  cancelPresent?(requestId: string, response: FeedbackResponse): void;
  /**
   * Optional: one-way notice (e.g. "solve CAPTCHA in the headed browser").
   * Does not wait for a reply — pair with page auto-detect / later present.
   */
  notify?(message: string): Promise<void>;
}

/**
 * Optional parallel resolver raced against `adapter.present`.
 * Return a response to win the race, or never resolve / hang until abort.
 */
export type FeedbackAutoResolve = (
  request: FeedbackRequest,
  signal: AbortSignal
) => Promise<FeedbackResponse>;

/**
 * Minimal surface the broker needs from AgentRuntime
 * (keeps this package free of a hard dependency on @relay/runtime).
 */
export interface FeedbackHost {
  on(event: string, listener: (req: FeedbackRequest) => void): unknown;
  off(event: string, listener: (req: FeedbackRequest) => void): unknown;
  provideFeedback(response: FeedbackResponse): Promise<void>;
}
