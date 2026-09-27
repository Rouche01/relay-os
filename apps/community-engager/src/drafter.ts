import type { CommunityDraft, PromoIntensity } from "./types.js";
import { FIXTURE_THREADS } from "./fixtures/threads.js";

/**
 * Stub drafter — helpful reply from fixture OP text / title.
 * Later: LLM via llm-controller + VoltMem memory injection.
 */
export async function draftReply(
  draft: CommunityDraft,
  overrides?: { text?: string; intensity?: PromoIntensity }
): Promise<CommunityDraft> {
  const fixture = FIXTURE_THREADS.find((t) => t.id === draft.id);
  const intensity = clampIntensity(overrides?.intensity ?? draft.intensity);
  const text =
    overrides?.text ??
    buildStubDraft({
      title: draft.threadTitle,
      opText: fixture?.opText ?? "",
      intensity,
      subreddit: draft.subreddit,
    });

  return {
    ...draft,
    draftText: text,
    intensity,
    status: "pending_approval",
  };
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
}): string {
  const helpFirst =
    `Hey — for “${input.title}”, a simple approach that works without buying anything new:\n` +
    `1) Pick 3–5 roles your clothes need to cover (work / weekend / layer).\n` +
    `2) Audit what you already own against those roles.\n` +
    `3) Only then fill gaps — one piece at a time.\n`;

  if (input.intensity === 0) {
    return (
      helpFirst +
      `\n(Happy to unpack any of those steps if useful.)`
    );
  }

  return (
    helpFirst +
    `\nI've been dogfooding a small styling helper (GoStylens) for the “system” part — ` +
    `no hard sell, just mentioning in case the structure resonates. Happy to share the free approach either way.`
  );
}
