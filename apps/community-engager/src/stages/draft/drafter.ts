import {
  createDraftLlmClient,
  draftLlmConfigured,
  generateDraftViaLlm,
  prefersHelpFirstMemory,
  presenceForcesIntensity0,
  PRODUCT_RE,
  resolveDraftLlmProvider,
} from "./draft-llm.js";
import {
  clampIntensityToPlaybook,
  DEFAULT_PLAYBOOK,
  type SubredditPlaybook,
} from "../../policy/playbook.js";
import { getCommunityConfig } from "../../reddit/config.js";
import { isMegathread } from "../../reddit/scout/score.js";
import { applySoftCta } from "./soft-cta.js";
import { stripEmDashes } from "./strip-em-dashes.js";
import type {
  CommunityDraft,
  DraftProvider,
  PromoIntensity,
} from "../../types.js";
import { FIXTURE_THREADS } from "../../fixtures/threads.js";
import { buildJobUtm } from "../execute/utm.js";

export { stripEmDashes } from "./strip-em-dashes.js";

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
 * Draft a reply. Uses COMMUNITY_DRAFT_LLM (gemini|anthropic) when that
 * provider’s API key is set and no text override was supplied; otherwise the stub.
 * API or validation failure falls back to the stub.
 * Soft-CTA shaping runs on every path (help first; 1=mention; 2=disclose+LP).
 */
export async function draftReply(
  draft: CommunityDraft,
  overrides?: DraftReplyOptions
): Promise<DraftReplyOutcome> {
  const fixture = FIXTURE_THREADS.find((t) => t.id === draft.id);
  const playbook = overrides?.playbook ?? DEFAULT_PLAYBOOK;
  const presenceLane = presenceForcesIntensity0(draft);
  const forceIntensity0 = Boolean(
    overrides?.warmupActive ||
      overrides?.forceIntensity0 ||
      overrides?.plugsWeekBlocked ||
      presenceLane
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

  if (!overrides?.text && draftLlmConfigured()) {
    const providerId = resolveDraftLlmProvider();
    try {
      const client = createDraftLlmClient();
      const llm = await generateDraftViaLlm({
        draft,
        memoryBlock,
        client,
        warmupActive: forceIntensity0,
        lpBaseUrl,
        playbook,
      });
      const provider: DraftProvider =
        llm.provider === "anthropic" ? "anthropic" : "gemini";
      const draftModel =
        typeof llm.model === "string" && llm.model.trim()
          ? llm.model.trim()
          : provider;
      return {
        provider,
        draft: finalizeDraft(
          {
            ...draft,
            draftText: llm.draftText,
            intensity: presenceLane ? 0 : llm.intensity,
            status: "pending_approval",
            draftProvider: provider,
            draftModel,
          },
          { forceIntensity0, lpBaseUrl, playbook }
        ),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[draft] ${providerId} failed; using stub (${message})`
      );
    }
  }

  const text =
    overrides?.text ??
    (presenceLane
      ? buildPresenceStubDraft({
          title: draft.threadTitle,
          opText: draft.opText ?? fixture?.opText ?? "",
          mediaLed: Boolean(draft.opMediaHint),
        })
      : buildStubDraft({
          title: draft.threadTitle,
          opText: draft.opText ?? fixture?.opText ?? "",
          intensity: forceIntensity0 ? 0 : intensity,
          subreddit: draft.subreddit,
          memoryHint: Boolean(memoryBlock),
          lpBaseUrl,
          campaign: draft.utmCampaign,
          mediaLed: Boolean(draft.opMediaHint),
        }));

  return {
    provider: "stub",
    draft: finalizeDraft(
      {
        ...draft,
        draftText: text,
        intensity: forceIntensity0 ? 0 : intensity,
        status: "pending_approval",
        draftProvider: "stub",
        draftModel: "stub",
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
  const clamped = applyWarmupClamp(shaped, opts.forceIntensity0, {
    title: draft.threadTitle,
    subreddit: draft.subreddit,
    memoryHint: true,
    opText: draft.opText,
    lpBaseUrl: opts.lpBaseUrl,
  });
  return {
    ...clamped,
    draftText: stripEmDashes(clamped.draftText),
  };
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
  const helpOnly = presenceForcesIntensity0(draft)
    ? buildPresenceStubDraft({
        title,
        opText: stubCtx?.opText ?? draft.opText ?? "",
        mediaLed: Boolean(draft.opMediaHint),
      })
    : buildStubDraft({
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
  mediaLed?: boolean;
}): string {
  const helpFirst = input.mediaLed
    ? `For “${input.title}” I can't see the photos, so I won't guess the pieces. ` +
      `What's the dressiest item in the set, and are you aiming polished or more relaxed? ` +
      `Those two usually decide the path.`
    : input.opText.trim().length > 40
      ? `On “${input.title}” I'd lean on what you already called out and pick one priority (comfort, polish, or repeat wear). ` +
        `Once that's clear, the next piece is easier.`
      : `On “${input.title}” I'd get specific before buying or rebuilding: what's the main constraint (work hours, heat, budget, body change)? ` +
        `Name that and people can actually suggest pieces that fit.`;

  const memoryNote = input.memoryHint
    ? ` Keeping this help-first based on past feedback.`
    : "";

  if (input.intensity === 0) {
    return helpFirst + memoryNote;
  }

  if (input.intensity === 1) {
    return (
      helpFirst +
      ` I've been trying a small styling helper called GoStylens for the “keep it coherent” part (just the name, no link).` +
      memoryNote
    );
  }

  // Intensity 2 stub: disclosure + LP (soft-cta will normalize UTM).
  const lp = input.lpBaseUrl ?? "https://gostylens.app";
  return (
    helpFirst +
    ` Full disclosure: I'm the founder of GoStylens. If a lightweight system helper sounds useful: ${lp}` +
    memoryNote
  );
}

/** Short presence-lane stub (intensity 0, no product). */
export function buildPresenceStubDraft(input: {
  title: string;
  opText: string;
  mediaLed?: boolean;
}): string {
  const title = input.title.trim() || "this look";
  if (input.mediaLed) {
    return (
      `On “${title}” I'd push one notch dressier or more relaxed so it reads on purpose. ` +
      `Mixed signals are what make a look feel unfinished.`
    );
  }
  const body = input.opText.trim();
  if (body.length > 40) {
    return (
      `On “${title}” I'd keep the strongest note from what you wrote and quiet the rest. ` +
      `That usually fixes the almost-there feeling faster than adding more.`
    );
  }
  return (
    `For “${title}” my take is commit to one note (sharp, soft, or loud) and drop whatever fights it. ` +
    `Mixed signals are what make fits feel off.`
  );
}
