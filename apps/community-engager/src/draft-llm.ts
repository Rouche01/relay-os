import type { CommunityDraft, PromoIntensity } from "./types.js";

/** Same model as GeminiProvider in @relay/llm-controller. */
export const DRAFT_MODEL = "gemini-2.5-flash";

const OP_TEXT_MAX_CHARS = 4000;
const MEMORY_MAX_CHARS = 2000;
const DRAFT_TEXT_MAX_CHARS = 4000;

const PRODUCT_RE = /\bgostylens\b/i;
const DISCLOSURE_RE =
  /\b(disclosure|disclos(?:e|ing)|i(?:'m| am) the (?:founder|maker|builder)|i built|full disclosure)\b/i;

export interface ParsedDraftJson {
  draftText: string;
  intensity: PromoIntensity;
  rationale?: string;
}

export function geminiDraftKey(explicit?: string): string | undefined {
  const key = (explicit ?? process.env.GEMINI_API_KEY ?? "").trim();
  return key || undefined;
}

/** Past abort / spam feedback should keep the reply help-only. */
export function prefersHelpFirstMemory(memoryBlock: string): boolean {
  return /abort/i.test(memoryBlock) || /spam|hard sell|too promo|intensity=2/i.test(memoryBlock);
}

export function buildDraftPrompt(draft: CommunityDraft, memoryBlock?: string): string {
  const opText = (draft.opText ?? "").trim().slice(0, OP_TEXT_MAX_CHARS);
  const memory = (memoryBlock ?? "").trim().slice(0, MEMORY_MAX_CHARS);
  const memorySection = memory
    ? `Past human feedback (do not quote it; only become more conservative):\n${memory}`
    : "Past human feedback: none.";

  return [
    "You write one Reddit comment reply for a fashion and styling community.",
    "The product is GoStylens, a small styling helper. Voice is help-first.",
    "",
    "Intensity rules:",
    "- 0: answer the post with concrete help only. Do not mention GoStylens.",
    "- 1: give the help first, then one soft GoStylens sentence the reader can ignore. Never hard-sell.",
    "- 2: rare. Use only when the comment already includes a clear founder disclosure. Otherwise use 0 or 1.",
    "- If past feedback mentions abort, spam, hard sell, or too much promo, intensity must be 0 and GoStylens must not appear.",
    "",
    "Reply rules:",
    "- Answer this thread, using the title and the original post body.",
    "- Plain sentences. No markdown headings, no hashtags, no bullet templates.",
    "- Do not invent prices, shops, or a personal story you were not given.",
    "- Keep draftText under 900 characters.",
    "",
    `Subreddit: r/${draft.subreddit}`,
    `Title: ${draft.threadTitle}`,
    "Original post:",
    opText || "(no body; use the title)",
    "",
    memorySection,
  ].join("\n");
}

/**
 * Parse model JSON and clamp intensity.
 * Intensity 2 survives only when the comment already discloses.
 * Returns null when draftText is missing or too long.
 */
export function parseDraftModelJson(raw: string, memoryBlock?: string): ParsedDraftJson | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const draftText = typeof obj.draftText === "string" ? obj.draftText.trim() : "";
  if (!draftText || draftText.length > DRAFT_TEXT_MAX_CHARS) return null;
  if (memoryBlock && prefersHelpFirstMemory(memoryBlock) && PRODUCT_RE.test(draftText)) {
    return null;
  }

  const rationale =
    typeof obj.rationale === "string" && obj.rationale.trim()
      ? obj.rationale.trim()
      : undefined;

  return {
    draftText,
    intensity: clampModelIntensity(obj.intensity, draftText, memoryBlock),
    rationale,
  };
}

export function clampModelIntensity(
  raw: unknown,
  draftText: string,
  memoryBlock?: string
): PromoIntensity {
  if (memoryBlock && prefersHelpFirstMemory(memoryBlock)) return 0;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (n === 2) return DISCLOSURE_RE.test(draftText) ? 2 : 1;
  if (n === 1) return 1;
  return 0;
}

export async function generateGeminiDraft(input: {
  draft: CommunityDraft;
  memoryBlock?: string;
  apiKey?: string;
}): Promise<ParsedDraftJson> {
  const apiKey = geminiDraftKey(input.apiKey);
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY unset");
  }

  const genai = await import("@google/genai");
  const { Type, HarmCategory, HarmBlockThreshold } = genai;
  const ai = new genai.GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: DRAFT_MODEL,
    contents: buildDraftPrompt(input.draft, input.memoryBlock),
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          draftText: {
            type: Type.STRING,
            description: "The Reddit comment to propose for human approval.",
          },
          intensity: {
            type: Type.INTEGER,
            description: "0 help only, 1 soft mention, 2 only with founder disclosure.",
          },
          rationale: {
            type: Type.STRING,
            description: "One sentence on why this reply and intensity.",
          },
        },
        required: ["draftText", "intensity"],
      },
      temperature: 0.4,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
      ],
    },
  });

  const parsed = parseDraftModelJson(response.text ?? "", input.memoryBlock);
  if (!parsed) {
    throw new Error("Gemini draft JSON was empty or failed validation");
  }
  return parsed;
}
