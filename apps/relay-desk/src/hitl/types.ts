/** Subset of @relay/protocol FeedbackRequest for Desk HITL cards. */

export type FeedbackType =
  | "approval"
  | "choice"
  | "freeform"
  | "credential"
  | "progress"
  | "error"
  | "confirmation";

export type FeedbackAction = "abort" | "proceed" | "retry";

export interface FeedbackDetail {
  label: string;
  value: string;
}

export interface FeedbackContext {
  subjectId?: string;
  title?: string;
  body?: string;
  url?: string;
  details?: FeedbackDetail[];
  meta?: Record<string, unknown>;
}

export interface PendingFeedback {
  id: string;
  agentId: string;
  type: FeedbackType;
  prompt: string;
  required: boolean;
  options?: string[];
  context?: FeedbackContext;
  timeout_ms?: number;
  presentedAt?: string;
}

export interface PendingListResponse {
  pending: PendingFeedback[];
  notices?: { at: string; message: string }[];
}

/** Prefer computer meta.vncUrl; fall back to context.url. */
export function vncUrlFromPending(req: PendingFeedback): string | undefined {
  const meta = req.context?.meta;
  const fromMeta = meta && typeof meta.vncUrl === "string" ? meta.vncUrl.trim() : "";
  if (fromMeta) return fromMeta;
  const fromUrl = req.context?.url?.trim();
  if (fromUrl && /vnc\.html|6080|novnc/i.test(fromUrl)) return fromUrl;
  return fromUrl || undefined;
}

export function sessionIdFromPending(req: PendingFeedback): string | undefined {
  const meta = req.context?.meta;
  if (meta && typeof meta.sessionId === "string" && meta.sessionId.trim()) {
    return meta.sessionId.trim();
  }
  return undefined;
}
