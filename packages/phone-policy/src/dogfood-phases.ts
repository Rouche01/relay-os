import type {
  PhoneObservation,
  PhoneProgressGuardContext,
  PhoneProgressGuardResult,
} from "./types.js";

/** Telegram Amsterdam dogfood subgoals (dogfood only). */
export type TelegramDogfoodPhase = "find_chat" | "in_amsterdam" | "react";

export const DEFAULT_TELEGRAM_PHASE_BUDGETS: Record<
  TelegramDogfoodPhase,
  number
> = {
  find_chat: 8,
  in_amsterdam: 6,
  react: 5,
};

const AMSTERDAM_RE = /\bamsterdam\b/i;
const REACT_MENU_RE =
  /❤|♥️|❤️|\blove\b|\breact(?:ion|s)?\b|\bheart\b/i;

function elementBlob(el: {
  text?: unknown;
  content_desc?: unknown;
  [key: string]: unknown;
}): string {
  const parts: string[] = [];
  if (typeof el.text === "string") parts.push(el.text);
  if (typeof el.content_desc === "string") parts.push(el.content_desc);
  return parts.join(" ");
}

/** Collect text/desc from observe elements (cheap, no OCR). */
export function observationTextBlob(observation: PhoneObservation): string {
  const els = observation.elements ?? [];
  return els.map(elementBlob).join("\n");
}

/**
 * Heuristic phase from UIAutomator observe elements.
 * - `react` — Amsterdam visible and reaction affordances present
 * - `in_amsterdam` — Amsterdam in element text/desc (treated as open thread)
 * - `find_chat` — otherwise (chats list / search / wrong chat)
 */
export function telegramDogfoodPhase(
  observation: PhoneObservation
): TelegramDogfoodPhase {
  const blob = observationTextBlob(observation);
  const hasAmsterdam = AMSTERDAM_RE.test(blob);
  if (hasAmsterdam && REACT_MENU_RE.test(blob)) return "react";
  if (hasAmsterdam) return "in_amsterdam";
  return "find_chat";
}

export interface TelegramPhaseProgressInfo {
  iteration: number;
  phase: TelegramDogfoodPhase;
  stepsInPhase: number;
  max: number;
}

export interface TelegramPhaseProgressGuardOptions {
  budgets?: Partial<Record<TelegramDogfoodPhase, number>>;
  /** Called each observation after phase/step counters update. */
  onPhase?: (info: TelegramPhaseProgressInfo) => void;
}

/**
 * Seat-loop `progressGuard`: count steps per Telegram phase; over budget → stuck.
 * Max N means N observations in that phase are allowed; N+1 returns ok:false.
 */
export function createTelegramPhaseProgressGuard(
  options: TelegramPhaseProgressGuardOptions = {}
): (
  ctx: PhoneProgressGuardContext
) => PhoneProgressGuardResult {
  const budgets: Record<TelegramDogfoodPhase, number> = {
    ...DEFAULT_TELEGRAM_PHASE_BUDGETS,
    ...options.budgets,
  };
  let currentPhase: TelegramDogfoodPhase | null = null;
  let stepsInPhase = 0;

  return (ctx) => {
    const phase = telegramDogfoodPhase(ctx.observation);
    if (phase !== currentPhase) {
      currentPhase = phase;
      stepsInPhase = 1;
    } else {
      stepsInPhase += 1;
    }
    const max = budgets[phase];
    options.onPhase?.({
      iteration: ctx.iteration,
      phase,
      stepsInPhase,
      max,
    });
    if (stepsInPhase > max) {
      return {
        ok: false,
        error: `phase ${phase} budget exceeded (${stepsInPhase}/${max})`,
      };
    }
    return { ok: true };
  };
}
