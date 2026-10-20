import type { FeedbackRequest } from "@relay/protocol";

const MAX_TG = 4000;

/** Known `context.meta.kind` values from CommunityEngager (and peers). */
export type FeedbackCardKind =
  | "draft"
  | "discover"
  | "login"
  | "interstitial"
  | "otp"
  | "secret"
  | "generic";

/** Escape text for Telegram HTML parse mode. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Resolve card kind from meta.kind, with light fallbacks from request type.
 * App-agnostic: unknown kinds render as generic.
 */
export function resolveFeedbackKind(request: FeedbackRequest): FeedbackCardKind {
  const raw = request.context?.meta?.kind;
  if (typeof raw === "string") {
    const k = raw.toLowerCase();
    if (
      k === "draft" ||
      k === "discover" ||
      k === "login" ||
      k === "interstitial" ||
      k === "otp" ||
      k === "secret"
    ) {
      return k;
    }
  }
  if (request.type === "credential") return "login";
  if (request.type === "choice") return "discover";
  if (request.type === "confirmation") return "interstitial";
  if (request.type === "approval" && request.context?.body) return "draft";
  return "generic";
}

/** Notify-only draft: human posts on Reddit; no Approve→execute. */
export function isNotifyOnlyDraft(request: FeedbackRequest): boolean {
  return (
    resolveFeedbackKind(request) === "draft" &&
    request.type === "approval" &&
    request.context?.meta?.postMode === "manual"
  );
}

/**
 * Build a Telegram card from a generic FeedbackRequest.
 * Kind-aware headers / footers; still uses only FeedbackContext fields.
 */
export function formatFeedbackMessage(request: FeedbackRequest): string {
  const kind = resolveFeedbackKind(request);
  if (kind === "draft" && isNotifyOnlyDraft(request)) {
    return truncate(formatNotifyOnlyDraft(request), MAX_TG);
  }
  if (kind === "draft") {
    return truncate(formatAutoDraft(request), MAX_TG);
  }

  const lines: string[] = [];
  lines.push(headerLine(kind, request));
  if (!request.required) lines.push("<i>optional</i>");
  lines.push("");

  const prompt = request.prompt?.trim();
  if (prompt && !isRedundantPrompt(kind, prompt, request)) {
    lines.push(escapeHtml(prompt));
    lines.push("");
  }

  const ctx = request.context;
  if (ctx) {
    appendContextBlock(lines, kind, request);
  }

  if (request.options?.length) {
    lines.push("");
    lines.push(kind === "discover" ? "<b>Candidates</b>" : "<b>Options</b>");
    for (const opt of request.options) {
      lines.push(`• ${escapeHtml(opt)}`);
    }
  }

  lines.push("");
  lines.push(footerLine(kind, request));

  return truncate(lines.join("\n"), MAX_TG);
}

/**
 * Inline keyboard for a feedback present.
 * Notify-only drafts: no Approve/Abort (card is the copy-paste notify).
 */
export function replyMarkupForFeedback(request: FeedbackRequest): unknown {
  if (isNotifyOnlyDraft(request)) {
    return { inline_keyboard: [] };
  }
  return approveAbortKeyboard(request.id, request.type);
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

function isManualPostMode(request: FeedbackRequest): boolean {
  return request.context?.meta?.postMode === "manual";
}

/** Copy-paste first; minimal chrome. */
function formatNotifyOnlyDraft(request: FeedbackRequest): string {
  const ctx = request.context;
  const sub = detailValue(request, "Subreddit") ?? "Reddit";
  const lines: string[] = [];
  lines.push(`<b>Post on Reddit</b> · ${escapeHtml(sub)}`);
  lines.push("");

  if (ctx?.title) {
    if (ctx.url) {
      lines.push(
        `<a href="${escapeHtml(ctx.url)}">${escapeHtml(ctx.title)}</a>`
      );
    } else {
      lines.push(escapeHtml(ctx.title));
    }
    lines.push("");
  } else if (ctx?.url) {
    lines.push(escapeHtml(ctx.url));
    lines.push("");
  }

  const draft = ctx?.body?.trim();
  if (draft) {
    lines.push("<b>Copy this reply</b>");
    lines.push(`<pre>${escapeHtml(truncate(draft, 2800))}</pre>`);
    lines.push("");
  }

  const note = compactGuardNote(request);
  if (note) {
    lines.push(`<i>${escapeHtml(note)}</i>`);
    lines.push("");
  }

  lines.push(
    "<i>Paste on Reddit yourself — nothing is posted automatically.</i>"
  );
  return lines.join("\n");
}

/** Auto / dry-run draft: draft first, short meta, Approve footer. */
function formatAutoDraft(request: FeedbackRequest): string {
  const ctx = request.context;
  const sub = detailValue(request, "Subreddit");
  const lines: string[] = [];
  lines.push(
    sub
      ? `<b>Draft</b> · ${escapeHtml(sub)}`
      : `<b>Draft</b> · <code>approval</code>`
  );
  lines.push("");

  if (ctx?.title) {
    if (ctx.url) {
      lines.push(
        `<a href="${escapeHtml(ctx.url)}">${escapeHtml(ctx.title)}</a>`
      );
    } else {
      lines.push(`<b>Thread:</b> ${escapeHtml(ctx.title)}`);
    }
    lines.push("");
  }

  const score = detailValue(request, "Score");
  const intensity = detailValue(request, "Intensity");
  const metaBits = [score ? `score ${score}` : "", intensity ? `intensity ${intensity}` : ""]
    .filter(Boolean)
    .join(" · ");
  if (metaBits) {
    lines.push(`<i>${escapeHtml(metaBits)}</i>`);
    lines.push("");
  }

  const draft = ctx?.body?.trim();
  if (draft) {
    lines.push("<b>Reply draft</b>");
    lines.push(`<pre>${escapeHtml(truncate(draft, 2800))}</pre>`);
    lines.push("");
  }

  const note = compactGuardNote(request);
  if (note) {
    lines.push(`<i>${escapeHtml(note)}</i>`);
    lines.push("");
  }

  lines.push(footerLine("draft", request));
  return lines.join("\n");
}

/** One short line from warmup / promo / cadence details (if present). */
function compactGuardNote(request: FeedbackRequest): string | undefined {
  const details = request.context?.details ?? [];
  const warmup = details.find((d) => d.label.toLowerCase() === "warmup");
  const promo = details.find((d) => d.label.toLowerCase() === "promo ratio");
  const bits: string[] = [];
  if (warmup?.value) {
    bits.push(`Warmup: ${shorten(warmup.value, 80)}`);
  }
  if (promo?.value && /block|exceed|projected/i.test(promo.value)) {
    bits.push(`Promo capped`);
  }
  return bits.length ? bits.join(" · ") : undefined;
}

function shorten(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function headerLine(kind: FeedbackCardKind, request: FeedbackRequest): string {
  const sub = detailValue(request, "Subreddit");
  switch (kind) {
    case "draft":
      if (isManualPostMode(request)) {
        return sub
          ? `<b>Post on Reddit</b> · ${escapeHtml(sub)}`
          : `<b>Post on Reddit</b>`;
      }
      return sub
        ? `<b>Draft</b> · ${escapeHtml(sub)}`
        : `<b>Draft</b> · <code>approval</code>`;
    case "discover":
      return `<b>Discover</b> · promote one or more`;
    case "login":
      return `<b>Login</b> · credentials needed`;
    case "interstitial":
      return `<b>Challenge</b> · prove humanity / CAPTCHA`;
    case "otp":
    case "secret":
      return `<b>Challenge</b> · one-time code`;
    default:
      return `<b>Relay feedback</b> · <code>${escapeHtml(request.type)}</code>`;
  }
}

function footerLine(kind: FeedbackCardKind, request: FeedbackRequest): string {
  switch (kind) {
    case "draft":
      if (isManualPostMode(request)) {
        return "<i>Paste on Reddit yourself — nothing is posted automatically.</i>";
      }
      return (
        "<i>Approve</i> to continue (dry-run or live post) · " +
        "<i>Abort</i> · or reply <code>edit: …</code>"
      );
    case "discover":
      return (
        "<i>Reply with one or more</i> (e.g. <code>r/a, r/b</code>) · " +
        "<code>none (skip)</code> · or <i>Abort</i>"
      );
    case "login":
      return (
        "<i>Reply with credentials (not Approve):</i> " +
        "username on line 1, password on line 2 — or <code>abort</code>"
      );
    case "otp":
    case "secret":
      return (
        "<i>Reply with the code/secret (not Approve)</i> — or <code>abort</code>"
      );
    case "interstitial":
      return (
        "<i>Solve in the headed browser</i> — we auto-continue when clear, " +
        "or tap <i>Approve</i> · <i>Abort</i> skips"
      );
    default:
      if (request.type === "credential") {
        return (
          "<i>Reply with credentials (not Approve):</i> " +
          "username on line 1, password on line 2 — or <code>abort</code>"
        );
      }
      return "<i>Approve / Abort below, or reply:</i> <code>edit: …</code>";
  }
}

function appendContextBlock(
  lines: string[],
  kind: FeedbackCardKind,
  request: FeedbackRequest
): void {
  const ctx = request.context!;
  if (ctx.title) {
    const label =
      kind === "draft"
        ? "Thread"
        : kind === "discover"
          ? "Goal"
          : "Title";
    // Discover uses title as the question; avoid "Goal" unless it looks like a goal.
    const titleLabel =
      kind === "discover" && /promote|discover|subreddit/i.test(ctx.title)
        ? "Title"
        : label;
    lines.push(`<b>${titleLabel}:</b> ${escapeHtml(ctx.title)}`);
  }
  if (ctx.url) {
    lines.push(`<b>URL:</b> ${escapeHtml(ctx.url)}`);
  }
  if (ctx.subjectId && kind === "generic") {
    lines.push(`<b>Id:</b> <code>${escapeHtml(ctx.subjectId)}</code>`);
  }

  if (ctx.details?.length) {
    for (const d of ctx.details) {
      // Hint is restated in the footer for known kinds.
      if (d.label.toLowerCase() === "hint" && kind !== "generic") {
        continue;
      }
      // Subreddit already in draft header.
      if (kind === "draft" && d.label.toLowerCase() === "subreddit") {
        continue;
      }
      lines.push(
        `<b>${escapeHtml(d.label)}:</b> ${escapeHtml(d.value)}`
      );
    }
  }

  if (ctx.body) {
    lines.push("");
    if (kind === "draft") {
      lines.push("<b>Reply draft</b>");
      lines.push(`<pre>${escapeHtml(truncate(ctx.body, 2800))}</pre>`);
    } else if (kind === "discover") {
      lines.push("<b>Candidates</b>");
      lines.push(escapeHtml(truncate(ctx.body, 2800)));
    } else {
      lines.push("<b>Details</b>");
      lines.push(escapeHtml(truncate(ctx.body, 2800)));
    }
  }
}

function detailValue(
  request: FeedbackRequest,
  label: string
): string | undefined {
  const row = request.context?.details?.find(
    (d) => d.label.toLowerCase() === label.toLowerCase()
  );
  return row?.value?.trim() || undefined;
}

/** Avoid duplicating a long prompt that only restates the header. */
function isRedundantPrompt(
  kind: FeedbackCardKind,
  prompt: string,
  request: FeedbackRequest
): boolean {
  if (kind === "generic") return false;
  const title = request.context?.title?.trim();
  if (title && prompt === title) return true;
  // Short prompts that only restated the card purpose are noise.
  if (
    prompt.length < 80 &&
    /approve|credential|captcha|discover/i.test(prompt)
  ) {
    return true;
  }
  // Manual notify cards: prompt restates the copy-paste instructions.
  if (isManualPostMode(request) && /manual post|copy-paste|yourself/i.test(prompt)) {
    return true;
  }
  return false;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
