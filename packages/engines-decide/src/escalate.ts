import {
  decisionToFeedbackRequest,
  type DecisionEscalateInput,
  type FeedbackRequest,
} from "@relay/protocol";

export { decisionToFeedbackRequest } from "@relay/protocol";
export type { DecisionEscalateInput } from "@relay/protocol";

/** Thin alias — escalate a decide pause into an existing FeedbackRequest. */
export function escalateDecision(
  input: DecisionEscalateInput
): FeedbackRequest {
  return decisionToFeedbackRequest(input);
}
