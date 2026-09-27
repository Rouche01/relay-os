import type { FeedbackRequest, FeedbackResponse } from "@relay/protocol";

/**
 * Channel that presents a FeedbackRequest to a human and returns their reply.
 * Telegram, CLI, web, etc. all implement this.
 */
export interface FeedbackAdapter {
  readonly name: string;
  present(request: FeedbackRequest): Promise<FeedbackResponse>;
}

/**
 * Minimal surface the broker needs from AgentRuntime
 * (keeps this package free of a hard dependency on @relay/runtime).
 */
export interface FeedbackHost {
  on(event: string, listener: (req: FeedbackRequest) => void): unknown;
  off(event: string, listener: (req: FeedbackRequest) => void): unknown;
  provideFeedback(response: FeedbackResponse): Promise<void>;
}
