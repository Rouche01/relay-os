import {
  createLlmClient,
  parseLlmProviderId,
  resolveAnthropicApiKey,
  resolveGeminiApiKey,
  type LlmClient,
  type LlmProviderId,
} from "@relay/llm";
import type { SubredditPlaybook } from "../../policy/playbook.js";
import type { CommunityDraft, PromoIntensity } from "../../types.js";
import { inferOpMedia } from "./op-media.js";
import {
  DISCLOSURE_RE,
  normalizeLpBase,
  PRODUCT_RE,
} from "./soft-cta.js";

export { PRODUCT_RE } from "./soft-cta.js";

/** @deprecated Prefer DEFAULT_GEMINI_MODEL from @relay/llm — kept for callers. */
export const DRAFT_MODEL = "gemini-2.5-flash";

const OP_TEXT_MAX_CHARS = 4000;
const MEMORY_MAX_CHARS = 2000;
const DRAFT_TEXT_MAX_CHARS = 4000;

/** JSON Schema for draft structured output (Gemini + Anthropic tool). */
export const DRAFT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    draftText: {
      type: "string",
      description: "The Reddit comment to propose for human approval.",
    },
    intensity: {
      type: "integer",
      description:
        "0 help only, 1 soft name mention (no URL), 2 disclosure + one LP link.",
    },
    rationale: {
      type: "string",
      description: "One sentence on why this reply and intensity.",
    },
  },
  required: ["draftText", "intensity"],
};

export interface ParsedDraftJson {
  draftText: string;
  intensity: PromoIntensity;
  rationale?: string;
  provider?: LlmProviderId;
  model?: string;
}

/** COMMUNITY_DRAFT_LLM=gemini|anthropic (default gemini). */
export function resolveDraftLlmProvider(
  env: NodeJS.ProcessEnv = process.env
): LlmProviderId {
  return parseLlmProviderId(env.COMMUNITY_DRAFT_LLM, "gemini");
}

/** Optional COMMUNITY_DRAFT_MODEL override. */
export function resolveDraftLlmModel(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const m = (env.COMMUNITY_DRAFT_MODEL ?? "").trim();
  return m || undefined;
}

export function draftLlmApiKey(
  provider: LlmProviderId,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  if (provider === "anthropic") {
    return resolveAnthropicApiKey(env.ANTHROPIC_API_KEY);
  }
  return resolveGeminiApiKey(env.GEMINI_API_KEY);
}

/** True when the selected provider has an API key configured. */
export function draftLlmConfigured(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return Boolean(draftLlmApiKey(resolveDraftLlmProvider(env), env));
}

/** @deprecated Use draftLlmConfigured / draftLlmApiKey. */
export function geminiDraftKey(explicit?: string): string | undefined {
  return resolveGeminiApiKey(explicit);
}

export function createDraftLlmClient(
  env: NodeJS.ProcessEnv = process.env
): LlmClient {
  const provider = resolveDraftLlmProvider(env);
  const apiKey = draftLlmApiKey(provider, env);
  if (!apiKey) {
    throw new Error(
      provider === "anthropic"
        ? "ANTHROPIC_API_KEY unset"
        : "GEMINI_API_KEY unset"
    );
  }
  return createLlmClient({
    provider,
    apiKey,
    model: resolveDraftLlmModel(env),
  });
}

/** Past abort / spam / removal feedback should keep the reply help-only. */
export function prefersHelpFirstMemory(memoryBlock: string): boolean {
  return (
    /abort/i.test(memoryBlock) ||
    /spam|hard sell|too promo|intensity=2/i.test(memoryBlock) ||
    /tag=removed|comment removed|not publicly visible/i.test(memoryBlock)
  );
}

export function buildDraftPrompt(
  draft: CommunityDraft,
  memoryBlock?: string,
  opts?: {
    warmupActive?: boolean;
    lpBaseUrl?: string;
    playbook?: SubredditPlaybook;
  }
): string {
  const opText = (draft.opText ?? "").trim().slice(0, OP_TEXT_MAX_CHARS);
  const memory = (memoryBlock ?? "").trim().slice(0, MEMORY_MAX_CHARS);
  const memorySection = memory
    ? `Past human feedback (do not quote it; only become more conservative):\n${memory}`
    : "Past human feedback: none.";
  const lp = normalizeLpBase(opts?.lpBaseUrl ?? "https://gostylens.app");
  const pb = opts?.playbook;
  const playbookSection = pb
    ? [
        "Subreddit playbook (required):",
        `- Rules: ${pb.rulesSummary}`,
        `- Max plug style: ${pb.plugStyle} (none→intensity 0, mention→0–1, disclose_link→0–2).`,
        `- Megathreads: ${pb.megathreadPolicy}.`,
        `- Max plugs/week on this sub: ${pb.maxPlugsPerWeek}.`,
        "",
      ]
    : [];
  const warmupSection = opts?.warmupActive
    ? [
        "WARMUP MODE (required):",
        "- Intensity must be 0.",
        "- Do not mention GoStylens, any product, or any link.",
        "- Pure concrete help only — this account is still building trust.",
        "",
      ]
    : [];

  const media =
    draft.opMediaHint ??
    inferOpMedia({
      title: draft.threadTitle,
      opText,
      postUrl: draft.postUrl,
    }).hint;
  const mediaSection = media
    ? [
        "PHOTO / MEDIA CONSTRAINT (required):",
        media,
        "- Tie the reply to the occasion/goal in the title.",
        "- Either ask 1–2 specific questions about the pieces, or give one narrow take that still works without seeing them.",
        "- Never claim you can see the outfit or name garments that are not in the text.",
        "",
      ]
    : [];

  return [
    "You write one Reddit comment — as a regular person in a fashion/styling sub, not a coach or chatbot.",
    "Product context (only for intensity rules below): GoStylens is a small styling helper. Stay help-first.",
    "",
    "Voice (required):",
    "- Sound like a thoughtful commenter: casual, specific, a little opinionated.",
    "- Open by engaging the actual ask (quote or paraphrase one concrete detail from title/body).",
    "- One main suggestion OR one clear take, then optionally one short follow-up question.",
    "- 2–5 short sentences. Contractions are fine (I'd / you're / that's).",
    "- Ban AI/coach tells: numbered frameworks (1) 2) 3)), \"Hey —\", \"Happy to help/unpack\",",
    "  \"simple approach\", \"game changer\", \"I'd love to\", \"feel free to\", \"as an AI\",",
    "  \"great question\", bullet templates, and generic capsule/wardrobe sermons that fit any post.",
    "- Em dashes (—): almost never. Prefer commas, periods, or parentheses. Use an em dash only if a",
    "  short aside truly needs it; never as a stylistic habit between every clause.",
    "- No markdown headings, no hashtags, no emoji stacks.",
    "",
    ...warmupSection,
    ...playbookSection,
    ...mediaSection,
    "Soft-CTA pattern (always):",
    "- Lead with concrete help for this thread. Product comes after help, never before.",
    "- Never hard-sell. The reader must get value if they ignore the product entirely.",
    "",
    "Intensity rules:",
    "- 0: concrete help only. Do not mention GoStylens. No links.",
    "- 1: help first, then one soft GoStylens *mention by name only*. No URL. No CTA button language.",
    `- 2: rare. Help first, then clear founder disclosure, then exactly one link: ${lp}`,
    "- Prefer 0. Use 1 only when a system/tool framing clearly fits. Use 2 only when disclosure feels natural.",
    "- If past feedback mentions abort, spam, hard sell, or too much promo, intensity must be 0 and GoStylens must not appear.",
    "",
    "Content rules:",
    "- Answer *this* thread only; ground every tip in what OP wrote.",
    "- If the body is empty/thin and the title refers to specific items/photos, do not invent those items.",
    "- Do not invent prices, shops, or a personal story you were not given.",
    "- Keep draftText under 900 characters.",
    "",
    `Subreddit: r/${draft.subreddit}`,
    `Title: ${draft.threadTitle}`,
    "Original post:",
    opText || "(no body; use the title — and respect PHOTO / MEDIA CONSTRAINT if present)",
    "",
    memorySection,
  ].join("\n");
}

/**
 * Parse model JSON and clamp intensity.
 * Intensity 2 survives only when the comment already discloses.
 * Returns null when draftText is missing or too long.
 */
export function parseDraftModelJson(
  raw: string,
  memoryBlock?: string,
  opts?: { warmupActive?: boolean }
): ParsedDraftJson | null {
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
  const helpFirst =
    Boolean(opts?.warmupActive) ||
    Boolean(memoryBlock && prefersHelpFirstMemory(memoryBlock));
  if (helpFirst && PRODUCT_RE.test(draftText)) {
    return null;
  }

  const rationale =
    typeof obj.rationale === "string" && obj.rationale.trim()
      ? obj.rationale.trim()
      : undefined;

  return {
    draftText,
    intensity: clampModelIntensity(obj.intensity, draftText, memoryBlock, opts),
    rationale,
  };
}

export function clampModelIntensity(
  raw: unknown,
  draftText: string,
  memoryBlock?: string,
  opts?: { warmupActive?: boolean }
): PromoIntensity {
  if (opts?.warmupActive) return 0;
  if (memoryBlock && prefersHelpFirstMemory(memoryBlock)) return 0;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (n === 2) return DISCLOSURE_RE.test(draftText) ? 2 : 1;
  if (n === 1) return 1;
  return 0;
}

export async function generateDraftViaLlm(input: {
  draft: CommunityDraft;
  memoryBlock?: string;
  client: LlmClient;
  warmupActive?: boolean;
  lpBaseUrl?: string;
  playbook?: SubredditPlaybook;
  model?: string;
}): Promise<ParsedDraftJson> {
  const prompt = buildDraftPrompt(input.draft, input.memoryBlock, {
    warmupActive: input.warmupActive,
    lpBaseUrl: input.lpBaseUrl,
    playbook: input.playbook,
  });
  const result = await input.client.completeJson({
    messages: [{ role: "user", content: prompt }],
    schema: DRAFT_JSON_SCHEMA,
    temperature: 0.4,
    ...(input.model ? { model: input.model } : {}),
  });
  const parsed = parseDraftModelJson(result.text, input.memoryBlock, {
    warmupActive: input.warmupActive,
  });
  if (!parsed) {
    throw new Error(
      `${result.provider} draft JSON was empty or failed validation`
    );
  }
  return {
    ...parsed,
    provider: result.provider,
    model: result.model,
  };
}

/** @deprecated Use generateDraftViaLlm + createDraftLlmClient. */
export async function generateGeminiDraft(input: {
  draft: CommunityDraft;
  memoryBlock?: string;
  apiKey?: string;
  warmupActive?: boolean;
  lpBaseUrl?: string;
  playbook?: SubredditPlaybook;
}): Promise<ParsedDraftJson> {
  const client = createLlmClient({
    provider: "gemini",
    apiKey: input.apiKey,
  });
  return generateDraftViaLlm({
    draft: input.draft,
    memoryBlock: input.memoryBlock,
    client,
    warmupActive: input.warmupActive,
    lpBaseUrl: input.lpBaseUrl,
    playbook: input.playbook,
  });
}
