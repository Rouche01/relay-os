/**
 * Feedback Protocol — how agents pause and negotiate with a human.
 *
 * Edit pattern: for `approval` or `freeform` requests, adapters present
 * Approve / Edit / Abort. Map Edit to `action: "proceed"` with `value`
 * set to the revised primary content (string). Map Abort to `action: "abort"`.
 *
 * Optional feedback: when `required: false` (typical for `progress`),
 * the runtime must not block forever — auto-proceed on timeout or skip
 * if no adapter is listening.
 *
 * Context is app-agnostic. Domain apps map into it, e.g.:
 *   artifact id → subjectId, editable text → body, link → url,
 *   labels → details[]; opaque app fields → meta (e.g. credential kind).
 */

export type FeedbackType =
  | "approval"
  | "choice"
  | "freeform"
  | "credential"
  | "progress"
  | "error"
  | "confirmation";

/** First-class HITL actions. Edit is not a separate action — see module docs. */
export type FeedbackAction = "abort" | "proceed" | "retry";

/**
 * One labeled row for adapter UIs (CLI printout, Telegram card, etc.).
 * Prefer this over app-specific field names on the protocol.
 */
export interface FeedbackDetail {
  label: string;
  value: string;
}

/**
 * Adapter-facing context for any HITL pause.
 * Keep vocabulary generic so newsletter, community, researcher, etc. reuse it.
 * Put domain-only data in `meta` (opaque to adapters that don't know the app).
 */
export interface FeedbackContext {
  /** Stable id of the artifact under review (draft, migration job, …) */
  subjectId?: string;
  /** Short title for notifications / card headers */
  title?: string;
  /** Primary content — often the editable payload for Approve/Edit */
  body?: string;
  /** Canonical link (thread, doc, preview URL, …) */
  url?: string;
  /** Ordered key/value rows for adapters to render */
  details?: FeedbackDetail[];
  /**
   * Opaque app payload for round-trip (scoring structs, intensity, etc.).
   * Adapters should not require knowing these keys.
   */
  meta?: Record<string, unknown>;
}

export interface FeedbackRequest {
  id: string;
  agentId: string;
  type: FeedbackType;
  prompt: string;
  /**
   * When false, runtime may skip or auto-proceed (e.g. unattended `progress`).
   * When true, agent stays WAITING_USER until a response or hard timeout.
   */
  required: boolean;
  /** For `choice` type */
  options?: string[];
  /** Extra data for UI rendering — use generic FeedbackContext shape */
  context?: FeedbackContext;
  /** How long before the request expires / auto-proceeds / escalates */
  timeout_ms?: number;
}

export interface FeedbackResponse {
  requestId: string;
  agentId: string;
  /**
   * User input: boolean (approval), string (freeform / edited body),
   * or selected option. For edits, put the revised primary content here.
   */
  value?: unknown;
  /**
   * - `proceed` — continue (approve as-is, or with edits in `value`)
   * - `abort` — terminate cleanly; do not run subsequent execute/write stages
   * - `retry` — re-run the current (or failed) stage
   */
  action?: FeedbackAction;
}

/** True when the human chose abort. */
export function isAbortResponse(response: FeedbackResponse): boolean {
  return response.action === "abort";
}

/** True when proceed carries a non-empty string edit (revised body). */
export function isEditResponse(response: FeedbackResponse): boolean {
  return (
    response.action !== "abort" &&
    response.action !== "retry" &&
    typeof response.value === "string" &&
    response.value.trim().length > 0
  );
}

/**
 * Whether this request must block the stage loop.
 * Optional / progress feedback does not block indefinitely.
 */
export function isBlockingFeedback(request: FeedbackRequest): boolean {
  if (!request.required) return false;
  return true;
}
