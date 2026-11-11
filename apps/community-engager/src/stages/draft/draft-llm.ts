import {
  createLlmClient,
  parseLlmProviderId,
  resolveAnthropicApiKey,
  resolveGeminiApiKey,
  type LlmClient,
  type LlmContentPart,
  type LlmProviderId,
} from "@relay/llm";
import type { SubredditPlaybook } from "../../policy/playbook.js";
import {
  engageKindOf,
  type CommunityDraft,
  type PromoIntensity,
} from "../../types.js";
import { loadDraftOpImages, type FetchedOpImage } from "./op-image.js";
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

/**
 * Presence lane always ships intensity 0 in v1 (no product plugs).
 * Help-lane promo stays separate until karma/reply thresholds land later.
 */
export function presenceForcesIntensity0(draft: {
  kind?: string | null;
}): boolean {
  return engageKindOf(draft) === "presence";
}

function sharedThreadContext(
  draft: CommunityDraft,
  memoryBlock?: string,
  opts?: { imageAttached?: boolean; imageCount?: number }
): {
  opText: string;
  memorySection: string;
  mediaSection: string[];
} {
  const opText = (draft.opText ?? "").trim().slice(0, OP_TEXT_MAX_CHARS);
  const memory = (memoryBlock ?? "").trim().slice(0, MEMORY_MAX_CHARS);
  const memorySection = memory
    ? `Past human feedback (do not quote it; only become more conservative):\n${memory}`
    : "Past human feedback: none.";
  const media =
    draft.opMediaHint ??
    inferOpMedia({
      title: draft.threadTitle,
      opText,
      postUrl: draft.postUrl,
      permalink: draft.threadUrl,
    }).hint;

  if (opts?.imageAttached) {
    const n = Math.max(1, opts.imageCount ?? 1);
    const slideNote =
      n > 1
        ? `- ${n} gallery images are attached in order (slide 1…${n}). Use all of them; later slides are often alt angles or related items.`
        : "- You can see what they posted (outfit photo, product shot, or a screenshot of a product page).";
    return {
      opText,
      memorySection,
      mediaSection: [
        n > 1
          ? `PHOTO / MEDIA (required — ${n} OP images are attached to this message):`
          : "PHOTO / MEDIA (required — the OP image is attached to this message):",
        slideNote,
        "- Ground silhouette, colors, materials, footwear, fit, and proportions in what you see — not a generic answer to the title alone.",
        "- If the image(s) already show a specific item (style, material, brand, or price), react to THAT item. Do not recommend a different style as if they showed nothing.",
        "- If a price is readable in an image, do not ask what their budget is.",
        "- Still skip stock openers like \"From the pic, yeah\".",
        "- Tie the reply to the occasion/goal in the title and any details in the body.",
        "- Prefer one concrete take. Ask at most one question only if a key detail is still missing from both image and text.",
        "- Do not invent brands or logos you cannot clearly read in the image(s).",
        "",
      ],
    };
  }

  const mediaSection = media
    ? [
        "PHOTO / MEDIA CONSTRAINT (required):",
        media,
        "- They attached photo(s) you cannot see. Do not invent colors, materials, brands, or prices.",
        "- Do not write a generic shopping recommendation that ignores the photo (e.g. naming a style/material when they may already be showing one).",
        "- Prefer fit/use advice that works regardless of the specific pair, or ask one short clarifying question about what is in the photo.",
        "- Briefly note they shared a photo if it helps, but skip stock openers like \"From the pic, yeah\".",
        "- Tie the reply to the occasion/goal in the title and any details in the body.",
        "- Never claim you can see the outfit clearly.",
        "",
      ]
    : [];
  return { opText, memorySection, mediaSection };
}

/** Help-lane prompt (advice / systems asks). */
export function buildDraftPrompt(
  draft: CommunityDraft,
  memoryBlock?: string,
  opts?: {
    warmupActive?: boolean;
    lpBaseUrl?: string;
    playbook?: SubredditPlaybook;
    /** True when an OP image is attached as a multimodal part. */
    imageAttached?: boolean;
    /** Number of attached gallery / OP images. */
    imageCount?: number;
  }
): string {
  const { opText, memorySection, mediaSection } = sharedThreadContext(
    draft,
    memoryBlock,
    { imageAttached: opts?.imageAttached, imageCount: opts?.imageCount }
  );
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
        "- Pure concrete help only. This account is still building trust.",
        "",
      ]
    : [];

  return [
    "You write one Reddit comment as a regular person in a fashion/styling sub, not a coach or chatbot.",
    "Product context (only for intensity rules below): GoStylens is a small styling helper. Stay help-first.",
    "",
    "Voice (required):",
    "- Sound like a thoughtful commenter: casual, specific, a little opinionated. Write how a human types on Reddit.",
    "- Open by engaging the actual ask (quote or paraphrase one concrete detail from title/body).",
    "- One main suggestion OR one clear take. Optionally one short follow-up question only when something real is missing (fit, rise, budget, dressiness).",
    "- 2-5 short sentences. Contractions are fine (I'd / you're / that's).",
    "- Ban AI/coach/retail tells: numbered frameworks (1) 2) 3)), \"Hey -\", \"Happy to help/unpack\",",
    "  \"simple approach\", \"game changer\", \"I'd love to\", \"feel free to\", \"as an AI\",",
    "  \"great question\", \"From the pic/pics, yeah\", \"you'd want\", \"check out X or Y\",",
    "  polished catalog copy, semicolon-stacked brand pitches, forced coach closers after a full answer,",
    "  bullet templates, and generic capsule/wardrobe sermons that fit any post.",
    "- Em dashes and en dashes: never. Prefer commas, periods, or parentheses.",
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
    "- Answer *this* thread only; ground every tip in the title, body, and attached image when present.",
    opts?.imageAttached
      ? "- The image is attached — treat it as primary evidence. Do not answer the title in the abstract while ignoring what they showed."
      : "- If the body is empty/thin and the title refers to specific items/photos, do not invent those items.",
    "- Do not invent prices, shops, or a personal story you were not given (readable text in an attached image is allowed).",
    "- Keep draftText under 900 characters.",
    "",
    `Subreddit: r/${draft.subreddit}`,
    `Title: ${draft.threadTitle}`,
    "Original post:",
    opText ||
      (opts?.imageAttached
        ? "(no body; use the title and the attached image)"
        : "(no body; use the title, and respect PHOTO / MEDIA CONSTRAINT if present)"),
    "",
    memorySection,
  ].join("\n");
}

/**
 * Presence-lane prompt: short take / tip / light joke on fashion threads.
 * Intensity is always 0 (no product, no links).
 */
export function buildPresenceDraftPrompt(
  draft: CommunityDraft,
  memoryBlock?: string,
  opts?: {
    playbook?: SubredditPlaybook;
    imageAttached?: boolean;
    imageCount?: number;
  }
): string {
  const { opText, memorySection, mediaSection } = sharedThreadContext(
    draft,
    memoryBlock,
    { imageAttached: opts?.imageAttached, imageCount: opts?.imageCount }
  );
  const pb = opts?.playbook;
  const playbookSection = pb
    ? [
        "Subreddit playbook (required):",
        `- Rules: ${pb.rulesSummary}`,
        `- Megathreads: ${pb.megathreadPolicy}.`,
        "- Presence lane: never plug a product on this reply.",
        "",
      ]
    : [];

  return [
    "You write one short Reddit comment as a regular person in a fashion sub — presence lane, not advice-coach mode.",
    "Goal: a sharp take, tip, or light joke that earns a glance. Sound human, not helpful-bot.",
    "",
    "Voice (required):",
    "- 1-3 short sentences. Contractions fine (I'd / you're / that's).",
    "- Lead with one concrete opinion or tip grounded in the title/body (fit, proportion, dressiness, vibe).",
    "- Optional light humor is OK if it lands clean; never mean-spirited roast of OP.",
    "- Do not open with \"Great question\", \"Happy to help\", \"From the pic\", or coach frameworks.",
    "- Ban AI/retail tells: numbered lists, \"game changer\", \"feel free to\", \"you'd want\", \"check out X\",",
    "  bullet templates, capsule sermons, polished catalog copy.",
    "- Em dashes and en dashes: never. Prefer commas, periods, or parentheses.",
    "- No markdown headings, no hashtags, no emoji stacks, no links.",
    "",
    "PRESENCE MODE (required):",
    "- Intensity must be 0.",
    "- Do not mention GoStylens, any product, app, tool, or URL.",
    "- Do not soft-sell. Pure presence / take only.",
    "",
    ...playbookSection,
    ...mediaSection,
    "Content rules:",
    "- React to *this* thread only; ground the take in the title, body, and attached image when present.",
    opts?.imageAttached
      ? "- The image is attached — react to what you see (product page screenshots count). Do not ignore the shown item for a generic take."
      : "- If the body is thin and they posted a photo, speak to the occasion/goal in the title — do not invent garments.",
    "- Do not invent prices, shops, or a personal story you were not given (readable text in an attached image is allowed).",
    "- Keep draftText under 400 characters.",
    "",
    `Subreddit: r/${draft.subreddit}`,
    `Title: ${draft.threadTitle}`,
    "Original post:",
    opText ||
      (opts?.imageAttached
        ? "(no body; use the title and the attached image)"
        : "(no body; use the title, and respect PHOTO / MEDIA CONSTRAINT if present)"),
    "",
    memorySection,
  ].join("\n");
}

/** Pick help vs presence prompt from draft.kind. */
export function buildDraftPromptForKind(
  draft: CommunityDraft,
  memoryBlock?: string,
  opts?: {
    warmupActive?: boolean;
    lpBaseUrl?: string;
    playbook?: SubredditPlaybook;
    imageAttached?: boolean;
    imageCount?: number;
  }
): string {
  if (presenceForcesIntensity0(draft)) {
    return buildPresenceDraftPrompt(draft, memoryBlock, {
      playbook: opts?.playbook,
      imageAttached: opts?.imageAttached,
      imageCount: opts?.imageCount,
    });
  }
  return buildDraftPrompt(draft, memoryBlock, opts);
}

/**
 * Parse model JSON and clamp intensity.
 * Intensity 2 survives only when the comment already discloses.
 * Returns null when draftText is missing or too long.
 */
export function parseDraftModelJson(
  raw: string,
  memoryBlock?: string,
  opts?: { warmupActive?: boolean; presenceLane?: boolean }
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
    Boolean(opts?.presenceLane) ||
    Boolean(memoryBlock && prefersHelpFirstMemory(memoryBlock));
  if (helpFirst && PRODUCT_RE.test(draftText)) {
    return null;
  }
  if (opts?.presenceLane && draftText.length > 400) {
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
  opts?: { warmupActive?: boolean; presenceLane?: boolean }
): PromoIntensity {
  if (opts?.warmupActive || opts?.presenceLane) return 0;
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
  /** Injected multi-image fetch (tests). */
  loadImages?: typeof loadDraftOpImages;
  /**
   * Legacy single-image inject — wrapped as a 0–1 gallery.
   * Prefer {@link loadImages}.
   */
  loadImage?: (
    draft: Pick<CommunityDraft, "postUrl" | "threadUrl" | "imageUrl">
  ) => Promise<FetchedOpImage | null>;
}): Promise<ParsedDraftJson> {
  const presenceLane = presenceForcesIntensity0(input.draft);
  const loadImages =
    input.loadImages ??
    (input.loadImage
      ? async (d: Pick<CommunityDraft, "postUrl" | "threadUrl" | "imageUrl">) => {
          const one = await input.loadImage!(d);
          return one ? [one] : [];
        }
      : loadDraftOpImages);
  let images: FetchedOpImage[] = [];
  try {
    images = await loadImages(input.draft);
    for (const img of images) {
      console.log(
        `[draft:image] attached ${img.mimeType} ${img.bytes}B from ${img.sourceUrl.slice(0, 80)}`
      );
    }
    if (images.length > 1) {
      console.log(`[draft:image] gallery slides attached=${images.length}`);
    }
  } catch (err) {
    console.warn(
      `[draft:image] load failed; text-only media hint:`,
      err instanceof Error ? err.message : err
    );
  }

  const imageAttached = images.length > 0;
  const imageCount = images.length;
  const prompt = buildDraftPromptForKind(input.draft, input.memoryBlock, {
    warmupActive: input.warmupActive || presenceLane,
    lpBaseUrl: input.lpBaseUrl,
    playbook: input.playbook,
    imageAttached,
    imageCount,
  });

  const content: string | LlmContentPart[] = imageAttached
    ? [
        { type: "text", text: prompt },
        ...images.map(
          (img): LlmContentPart => ({ type: "image_url", url: img.dataUrl })
        ),
      ]
    : prompt;

  const result = await input.client.completeJson({
    messages: [{ role: "user", content }],
    schema: DRAFT_JSON_SCHEMA,
    temperature: presenceLane ? 0.55 : 0.4,
    ...(input.model ? { model: input.model } : {}),
  });
  const parsed = parseDraftModelJson(result.text, input.memoryBlock, {
    warmupActive: input.warmupActive || presenceLane,
    presenceLane,
  });
  if (!parsed) {
    throw new Error(
      `${result.provider} draft JSON was empty or failed validation`
    );
  }
  return {
    ...parsed,
    intensity: presenceLane ? 0 : parsed.intensity,
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
