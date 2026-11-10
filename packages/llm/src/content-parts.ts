import type { LlmContentPart, LlmMessage } from "./types.js";
import { messageText } from "./types.js";

export interface ParsedDataUrl {
  mimeType: string;
  /** Raw base64 payload (no data: prefix). */
  data: string;
}

const DATA_URL_RE = /^data:([^;,]+);base64,(.+)$/i;

/** Parse `data:image/jpeg;base64,…` (or other mime) into mime + payload. */
export function parseDataUrl(url: string): ParsedDataUrl | null {
  const m = DATA_URL_RE.exec(url.trim());
  if (!m?.[1] || !m[2]) return null;
  return { mimeType: m[1].trim().toLowerCase(), data: m[2] };
}

export function contentHasImage(content: LlmMessage["content"]): boolean {
  if (typeof content === "string") return false;
  return content.some((p) => p.type === "image_url" && Boolean(p.url?.trim()));
}

export function messagesHaveImage(messages: LlmMessage[]): boolean {
  return messages.some((m) => contentHasImage(m.content));
}

/** Flatten text from parts; empty string when none. */
export function partsText(parts: LlmContentPart[]): string {
  return parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim();
}

export function asPartArray(
  content: LlmMessage["content"]
): LlmContentPart[] {
  if (typeof content === "string") {
    return content.trim() ? [{ type: "text", text: content }] : [];
  }
  return content;
}

/** System text + non-system messages (preserves multimodal content). */
export function splitSystemMessages(messages: LlmMessage[]): {
  system?: string;
  messages: LlmMessage[];
} {
  const systems: string[] = [];
  const rest: LlmMessage[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      const t = messageText(m.content).trim();
      if (t) systems.push(t);
      continue;
    }
    rest.push(m);
  }
  return {
    system: systems.length ? systems.join("\n\n") : undefined,
    messages: rest,
  };
}
