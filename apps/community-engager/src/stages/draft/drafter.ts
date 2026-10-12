import {
  geminiDraftKey,
  generateGeminiDraft,
  prefersHelpFirstMemory,
  PRODUCT_RE,
} from "./draft-llm.js";
import {
  clampIntensityToPlaybook,
  DEFAULT_PLAYBOOK,
  type SubredditPlaybook,
} from "../../policy/playbook.js";
import { getCommunityConfig } from "../../reddit/config.js";
import type { DraftProvider } from "../../run-evidence.js";
import { isMegathread } from "../../reddit/scout/score.js";
import { applySoftCta } from "./soft-cta.js";
import type { CommunityDraft, PromoIntensity } from "../../types.js";
import { FIXTURE_THREADS } from "../../fixtures/threads.js";
import { buildJobUtm } from "../execute/utm.js";

export interface DraftReplyOutcome {
  draft: CommunityDraft;
  provider: DraftProvider;
}

export interface DraftReplyOptions {
  text?: string;
  intensity?: PromoIntensity;
  /** From ContextEngine.rememberForPrompt — biases stub; not posted verbatim */
  memoryBlock?: string;
  /**
   * When true, force intensity 0 and strip product plugs (account warmup).
   * Overrides LLM intensity and soft-mention stubs.
   */
  warmupActive?: boolean;
  /**
   * Same clamp as warmup — used when promo-ratio ledger blocks plugs.
   */
  forceIntensity0?: boolean;
  /** Override LP base (tests). Default from getCommunityConfig().product.lpBaseUrl. */
  lpBaseUrl?: string;
  /** Sub playbook — clamps intensity (plug style + megathread help_only). */
  playbook?: SubredditPlaybook;
  /** When true, force intensity 0 (e.g. max plugs/week reached). */
  plugsWeekBlocked?: boolean;
}

/**
 * Draft a reply. Uses Gemini when GEMINI_API_KEY is set and no text override
 * was supplied; otherwise the stub. API or validation failure falls back to the stub.
 * Soft-CTA shaping runs on every path (help first; 1=mention; 2=disclose+LP).
 */
export async function draftReply(
  draft: CommunityDraft,
  overrides?: DraftReplyOptions
): Promise<DraftReplyOutcome> {
  const fixture = FIXTURE_THREADS.find((t) => t.id === draft.id);
  const playbook = overrides?.playbook ?? DEFAULT_PLAYBOOK;
  const forceIntensity0 = Boolean(
    overrides?.warmupActive ||
      overrides?.forceIntensity0 ||
      overrides?.plugsWeekBlocked
  );
  let intensity = clampIntensity(overrides?.intensity ?? draft.intensity);
  intensity = clampIntensityToPlaybook(intensity, playbook, {
    isMegathread: isMegathread(draft.threadTitle),
  });
  const memoryBlock = overrides?.memoryBlock;
  const lpBaseUrl =
    overrides?.lpBaseUrl ?? getCommunityConfig().product.lpBaseUrl;

  if (forceIntensity0 || (memoryBlock && prefersHelpFirstMemory(memoryBlock))) {
    intensity = 0;
  }

  if (!overrides?.text && geminiDraftKey()) {
    try {
      const llm = await generateGeminiDraft({
        draft,
        memoryBlock,
        warmupActive: forceIntensity0,
        lpBaseUrl,
        playbook,
      });
      return {
        provider: "gemini",
        draft: finalizeDraft(
          {
            ...draft,
            draftText: llm.draftText,
            intensity: llm.intensity,
            status: "pending_approval",
          },
          { forceIntensity0, lpBaseUrl, playbook }
        ),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[draft] Gemini failed; using stub (${message})`);
    }
  }

  const text =
    overrides?.text ??
    buildStubDraft({
      title: draft.threadTitle,
      opText: draft.opText ?? fixture?.opText ?? "",
      intensity: forceIntensity0 ? 0 : intensity,
      subreddit: draft.subreddit,
      memoryHint: Boolean(memoryBlock),
      lpBaseUrl,
      campaign: draft.utmCampaign,
    });

  return {
    provider: "stub",
    draft: finalizeDraft(
      {
        ...draft,
        draftText: text,
        intensity: forceIntensity0 ? 0 : intensity,
        status: "pending_approval",
      },
      { forceIntensity0, lpBaseUrl, playbook }
    ),
  };
}

function finalizeDraft(
  draft: CommunityDraft,
  opts: {
    forceIntensity0: boolean;
    lpBaseUrl: string;
    playbook: SubredditPlaybook;
  }
): CommunityDraft {
  const clampedIntensity = opts.forceIntensity0
    ? 0
    : clampIntensityToPlaybook(draft.intensity, opts.playbook, {
        isMegathread: isMegathread(draft.threadTitle),
      });
  const shaped = applySoftCta(
    { ...draft, intensity: clampedIntensity },
    {
      lpBaseUrl: opts.lpBaseUrl,
      forceIntensity0: opts.forceIntensity0,
      // Preview UTMs: app campaign + draft id as content (execute rewrites with jobId).
      utm: buildJobUtm({
        jobId: draft.id,
        subreddit: draft.subreddit,
      }),
    }
  );
  return applyWarmupClamp(shaped, opts.forceIntensity0, {
    title: draft.threadTitle,
    subreddit: draft.subreddit,
    memoryHint: true,
    opText: draft.opText,
    lpBaseUrl: opts.lpBaseUrl,
  });
}
/**
 * Hard clamp for warmup: intensity 0 and no GoStylens mention.
 * If the text still plugs the product, replace with a help-only stub.
 */
export function applyWarmupClamp(
  draft: CommunityDraft,
  warmupActive: boolean,
  stubCtx?: {
    title: string;
    subreddit: string;
    opText?: string;
    memoryHint?: boolean;
    lpBaseUrl?: string;
  }
): CommunityDraft {
  if (!warmupActive) return draft;
  if (draft.intensity === 0 && !PRODUCT_RE.test(draft.draftText)) {
    return { ...draft, intensity: 0 };
  }
  const title = stubCtx?.title ?? draft.threadTitle;
  const helpOnly = buildStubDraft({
    title,
    opText: stubCtx?.opText ?? draft.opText ?? "",
    intensity: 0,
    subreddit: stubCtx?.subreddit ?? draft.subreddit,
    memoryHint: stubCtx?.memoryHint ?? true,
    lpBaseUrl: stubCtx?.lpBaseUrl,
  });
  return {
    ...draft,
    intensity: 0,
    draftText: PRODUCT_RE.test(draft.draftText) ? helpOnly : draft.draftText,
  };
}

function clampIntensity(n: PromoIntensity): PromoIntensity {
  if (n === 2) return 2;
  if (n === 1) return 1;
  return 0;
}

function buildStubDraft(input: {
  title: string;
  opText: string;
  intensity: PromoIntensity;
  subreddit: string;
  memoryHint?: boolean;
  lpBaseUrl?: string;
  campaign?: string;
}): string {
  const helpFirst =
    `Hey — for “${input.title}”, a simple approach that works without buying anything new:\n` +
    `1) Pick 3–5 roles your clothes need to cover (work / weekend / layer).\n` +
    `2) Audit what you already own against those roles.\n` +
    `3) Only then fill gaps — one piece at a time.\n`;

  const memoryNote = input.memoryHint
    ? `\n(Keeping this help-first based on past feedback.)`
    : "";

  if (input.intensity === 0) {
    return helpFirst + `\n(Happy to unpack any of those steps if useful.)` + memoryNote;
  }

  if (input.intensity === 1) {
    return (
      helpFirst +
      `\nI've been dogfooding a small styling helper (GoStylens) for the “system” part — ` +
      `no link, just mentioning in case the structure resonates.` +
      memoryNote
    );
  }

  // Intensity 2 stub — disclosure + LP (soft-cta will normalize UTM).
  const lp = input.lpBaseUrl ?? "https://gostylens.app";
  return (
    helpFirst +
    `\nFull disclosure: I'm the founder of GoStylens. If a lightweight system helper sounds useful: ${lp}` +
    memoryNote
  );
}
