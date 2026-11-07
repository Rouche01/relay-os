import type {
  BrowseActionMixPriors,
  BrowseDecideInput,
  BrowseGoal,
  BrowseStepRecord,
} from "./types.js";

function formatMix(mix?: BrowseActionMixPriors): string {
  if (!mix) {
    return "Prefer natural browsing: mostly clicks and scrolls, occasional typing.";
  }
  const parts = Object.entries(mix)
    .filter(([, w]) => typeof w === "number" && w > 0)
    .map(([k, w]) => `${k}=${w}`);
  return parts.length
    ? `Soft action-mix priors (not a script): ${parts.join(", ")}.`
    : "Prefer natural browsing: mostly clicks and scrolls, occasional typing.";
}

function formatHistory(history: BrowseStepRecord[], limit = 5): string {
  if (history.length === 0) return "(no prior steps)";
  return history
    .slice(-limit)
    .map((s) => {
      const act =
        s.decision.kind === "act" && s.decision.action
          ? JSON.stringify(s.decision.action)
          : s.decision.kind;
      return `- step ${s.iteration}: waited ${s.waitedMs}ms → ${act}${
        s.decision.reason ? ` (${s.decision.reason})` : ""
      }`;
    })
    .join("\n");
}

export function buildBrowseSystemPrompt(goal: BrowseGoal): string {
  const allowed =
    goal.allowedActions && goal.allowedActions.length > 0
      ? `Allowed action types only: ${goal.allowedActions.join(", ")}.`
      : "Allowed action types: click, double_click, right_click, move, type, key, scroll.";

  return `You are simulating a careful human browsing a desktop browser.
You receive screenshots and a fixed high-level goal. Each turn, choose ONE next micro-action — do not invent a multi-step script.

Rules:
1. Pursue the goal; stop with kind "done" when the screenshot clearly shows the goal is met.
2. Use kind "need_human" only if you are blocked (login, captcha, ambiguous choice that needs a human).
3. Prefer one small action per turn (click, scroll, short type, key).
4. Coordinates are pixels on the provided screenshot (origin top-left).
5. ${allowed}
6. ${formatMix(goal.actionMix)}
7. Never claim success without visual evidence in the current screenshot.`;
}

export function buildBrowseUserPrompt(input: BrowseDecideInput): string {
  return `Goal (fixed):
${input.goal.text}

Progress: iteration ${input.iteration} of ${input.maxIterations}

Recent steps:
${formatHistory(input.history)}

Inspect the screenshot and return the next decision as JSON.`;
}
