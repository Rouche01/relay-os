import type { CommunityDraft, PromoIntensity } from "./types.js";
import { FIXTURE_THREADS } from "./fixtures/threads.js";

export interface DraftReplyOptions {
  text?: string;
  intensity?: PromoIntensity;
  /** From ContextEngine.rememberForPrompt — biases stub; not posted verbatim */
  memoryBlock?: string;
}

/**
 * Stub drafter — helpful reply from fixture OP text / title.
 * Uses agent memory (when present) to bias intensity / tone until LLM is wired.
 */
export async function draftReply(
  draft: CommunityDraft,
  overrides?: DraftReplyOptions
): Promise<CommunityDraft> {
  const fixture = FIXTURE_THREADS.find((t) => t.id === draft.id);
  let intensity = clampIntensity(overrides?.intensity ?? draft.intensity);

  if (overrides?.memoryBlock && shouldPreferHelpFirst(overrides.memoryBlock)) {
    intensity = 0;
  }

  const text =
    overrides?.text ??
    buildStubDraft({
      title: draft.threadTitle,
      opText: fixture?.opText ?? "",
      intensity,
      subreddit: draft.subreddit,
      memoryHint: Boolean(overrides?.memoryBlock),
    });

  return {
    ...draft,
    draftText: text,
    intensity,
    status: "pending_approval",
  };
}

function shouldPreferHelpFirst(memoryBlock: string): boolean {
  return /abort/i.test(memoryBlock) || /spam|hard sell|too promo|intensity=2/i.test(memoryBlock);
}

function clampIntensity(n: PromoIntensity): 0 | 1 {
  // Fixtures / v1 default to 0–1; intensity 2 needs extra confirmation later.
  return n === 2 ? 1 : n;
}

function buildStubDraft(input: {
  title: string;
  opText: string;
  intensity: 0 | 1;
  subreddit: string;
  memoryHint?: boolean;
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

  return (
    helpFirst +
    `\nI've been dogfooding a small styling helper (GoStylens) for the “system” part — ` +
    `no hard sell, just mentioning in case the structure resonates. Happy to share the free approach either way.` +
    memoryNote
  );
}
