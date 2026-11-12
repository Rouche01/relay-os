import type { ComputerObserveElement } from "@relay/engines-computer";
import type {
  PhoneActionMixPriors,
  PhoneDecideInput,
  PhoneGoal,
  PhoneStepRecord,
} from "./types.js";

const DEFAULT_PHONE_MIX: PhoneActionMixPriors = {
  swipe: 3,
  click: 2,
  key: 1,
  long_press: 1,
  launch: 1,
  type: 1,
};

function formatMix(mix?: PhoneActionMixPriors): string {
  const effective = mix ?? DEFAULT_PHONE_MIX;
  const parts = Object.entries(effective)
    .filter(([, w]) => typeof w === "number" && w > 0)
    .map(([k, w]) => `${k}=${w}`);
  return parts.length
    ? `Soft action-mix priors (not a script): ${parts.join(", ")}.`
    : "Prefer natural phone use: mostly swipes and taps, occasional keys.";
}

function formatHistory(history: PhoneStepRecord[], limit = 5): string {
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

function formatElements(
  elements: ComputerObserveElement[] | undefined,
  limit = 40
): string {
  if (!elements || elements.length === 0) return "";
  const lines = elements.slice(0, limit).map((el) => {
    const ref = el.ref != null ? String(el.ref) : "?";
    const text = typeof el.text === "string" ? el.text.slice(0, 80) : "";
    const desc =
      typeof el.content_desc === "string" ? el.content_desc.slice(0, 80) : "";
    const clickable = el.clickable === true ? "clickable" : "";
    return `- ref=${ref} text=${JSON.stringify(text)} desc=${JSON.stringify(desc)} ${clickable}`.trim();
  });
  const more =
    elements.length > limit ? `\n… ${elements.length - limit} more` : "";
  return `Visible UI elements (prefer action.ref when tapping known controls):\n${lines.join("\n")}${more}`;
}

export function buildPhoneSystemPrompt(goal: PhoneGoal): string {
  const allowed =
    goal.allowedActions && goal.allowedActions.length > 0
      ? `Allowed action types only: ${goal.allowedActions.join(", ")}.`
      : "Allowed action types: click, tap, swipe, long_press, launch, key, scroll, type.";

  return `You are simulating a careful human using an Android phone.
You receive a screenshot (and often a compact UI element list) plus a fixed high-level goal. Each turn, choose ONE next micro-action — do not invent a multi-step script.

Rules:
1. Decision kind must be exactly one of: "act", "done", "need_human" (not "action").
2. Pursue the goal; stop with kind "done" when the screen clearly shows the goal is met.
3. Use kind "need_human" only if you are blocked (login, captcha, ambiguous choice that needs a human).
4. Prefer one small action per turn (tap, swipe, short type, system key). When kind is "act", include an "action" object.
5. Coordinates are pixels on the provided screenshot (origin top-left). Prefer action.ref from the element list when available.
6. System chrome keys use action type "key" with text "back", "home", or "recents" — never desktop chords like ctrl+l.
7. Swipe with type "swipe" and x1,y1,x2,y2 (optional duration_ms). Launch apps with type "launch" and package and/or uri.
8. ${allowed}
9. ${formatMix(goal.actionMix)}
10. Never claim success without visual evidence in the current screenshot.
11. When the goal names a specific chat, app, or label, match that exact visible title before acting further. If you opened the wrong item, key "back" and correct course — do not continue the goal in the wrong screen.`;
}

export function buildPhoneUserPrompt(input: PhoneDecideInput): string {
  const elementsBlock = formatElements(input.observation.elements);
  return `Goal (fixed):
${input.goal.text}

Progress: iteration ${input.iteration} of ${input.maxIterations}

Recent steps:
${formatHistory(input.history)}
${elementsBlock ? `\n${elementsBlock}\n` : ""}
Inspect the screenshot${elementsBlock ? " and element list" : ""} and return the next decision as JSON.`;
}
