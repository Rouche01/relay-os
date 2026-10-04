import type { FeedbackRequest } from "@relay/protocol";

const MAX_TG = 4000;

/** Escape text for Telegram HTML parse mode. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Build a Telegram card from a generic FeedbackRequest.
 * Uses context.title / body / url / details — app-agnostic.
 */
export function formatFeedbackMessage(request: FeedbackRequest): string {
  const lines: string[] = [];
  lines.push(`<b>Relay feedback</b> · <code>${escapeHtml(request.type)}</code>`);
  if (!request.required) lines.push("<i>optional</i>");
  lines.push("");
  lines.push(escapeHtml(request.prompt));

  const ctx = request.context;
  if (ctx) {
    lines.push("");
    if (ctx.title) lines.push(`<b>Title:</b> ${escapeHtml(ctx.title)}`);
    if (ctx.url) lines.push(`<b>URL:</b> ${escapeHtml(ctx.url)}`);
    if (ctx.subjectId) lines.push(`<b>Id:</b> <code>${escapeHtml(ctx.subjectId)}</code>`);
    if (ctx.details?.length) {
      for (const d of ctx.details) {
        lines.push(`<b>${escapeHtml(d.label)}:</b> ${escapeHtml(d.value)}`);
      }
    }
    if (ctx.body) {
      lines.push("");
      lines.push("<b>Draft</b>");
      lines.push(`<pre>${escapeHtml(truncate(ctx.body, 2800))}</pre>`);
    }
  }

  if (request.options?.length) {
    lines.push("");
    lines.push("<b>Options:</b>");
    for (const opt of request.options) {
      lines.push(`• ${escapeHtml(opt)}`);
    }
  }

  lines.push("");
  if (request.type === "credential") {
    const kind = request.context?.meta?.kind;
    if (kind === "otp" || kind === "secret") {
      lines.push(
        "<i>Reply with the secret (not Approve)</i> — or <code>abort</code>"
      );
    } else {
      lines.push(
        "<i>Reply with credentials (not Approve):</i> username on line 1, password on line 2 — or <code>abort</code>"
      );
    }
  } else {
    lines.push("<i>Approve / Abort below, or reply:</i> <code>edit: …</code>");
  }

  return truncate(lines.join("\n"), MAX_TG);
}

export function approveAbortKeyboard(requestId: string, type?: string): unknown {
  // callback_data max 64 bytes — keep ids short
  const buttons =
    type === "credential"
      ? [[{ text: "🛑 Abort", callback_data: `r:no:${requestId}` }]]
      : [
          [
            { text: "✅ Approve", callback_data: `r:ok:${requestId}` },
            { text: "🛑 Abort", callback_data: `r:no:${requestId}` },
          ],
        ];
  return { inline_keyboard: buttons };
}

/** Extract request id from callback_data `r:ok:<id>` / `r:no:<id>`. */
export function parseCallbackData(
  data: string
): { action: "proceed" | "abort"; requestId: string } | null {
  const m = /^r:(ok|no):([A-Za-z0-9_-]+)$/.exec(data);
  if (!m) return null;
  return {
    action: m[1] === "ok" ? "proceed" : "abort",
    requestId: m[2],
  };
}

/** Parse `edit: …` (case-insensitive). */
export function parseEditCommand(text: string): string | null {
  const m = /^\s*edit:\s*([\s\S]+)$/i.exec(text);
  if (!m) return null;
  const body = m[1].trim();
  return body.length > 0 ? body : null;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
