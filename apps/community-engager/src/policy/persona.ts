/**
 * Lane personas — stance / judgment / rhythm for draft voice.
 * Playbook stays compliance-only (rules, plugs, megathreads); personality lives here.
 */

import {
  DEFAULT_ENGAGE_KIND,
  normalizeEngageKind,
  type EngageKind,
} from "../types.js";

/**
 * Commenter voice for one engagement lane.
 * Style + judgment only — not a chatty character card or invented biography.
 */
export interface LanePersona {
  /** Stable id, e.g. `help.default`. */
  id: string;
  lane: EngageKind;
  /** One-line who they are as a commenter (not a life story). */
  stance: string;
  /** How they decide / disagree. */
  judgment: string[];
  /** Length, openings, when to ask a clarifying question. */
  rhythm: string[];
  /** Extra bans beyond global anti-AI lists in the draft prompt. */
  bans: string[];
  /**
   * Curated facts allowed in replies. Empty / omitted → invent nothing personal.
   * Product / founder lines belong here only when operators authorize them.
   */
  authorizedFacts?: string[];
}

/** Help — practical wardrobe peer (deepest pack). */
export const DEFAULT_HELP_PERSONA: LanePersona = {
  id: "help.default",
  lane: "help",
  stance:
    "Practical wardrobe peer on Reddit: concrete, a little opinionated, never a stylist funnel.",
  judgment: [
    "Prioritize fit, rise, proportion, and use-case over brand names.",
    "Prefer one strong suggestion (or one clear take) over multi-step frameworks.",
    "If rise, budget, dressiness, or body context is missing, say so — do not guess.",
    "Disagree gently when the ask is off (wrong silhouette for the job) instead of soft-agreeing.",
  ],
  rhythm: [
    "Open by engaging one concrete detail from the title, body, or photo.",
    "2–5 short sentences; contractions are fine.",
    "Optional one clarifying question only when something real is missing.",
    "Lead with help; product mentions follow intensity rules elsewhere — never open with a pitch.",
  ],
  bans: [
    "Stylist-funnel openers and closers (Happy to help, great question, feel free to).",
    "Numbered wardrobe frameworks and capsule sermons that fit any post.",
    "Invented personal anecdotes, shops, or prices not in authorizedFacts or the thread.",
  ],
  authorizedFacts: [],
};

/** Presence — warm glance; intentionally light. */
export const DEFAULT_PRESENCE_PERSONA: LanePersona = {
  id: "presence.default",
  lane: "presence",
  stance:
    "Friendly scroll-by commenter: notice one real detail, earn a glance, never a consult.",
  judgment: [
    "Default to compliment + one visible detail (color, shoes, bag, socks, vibe).",
    "A tip only when OP clearly asked for feedback — never unsolicited coaching on flex/OOTD.",
    "Humor rare and kind; never mean-spirited.",
  ],
  rhythm: [
    "1–2 short sentences (3 only if still casual).",
    "Keep under a glance length — presence is not an advice essay.",
  ],
  bans: [
    "Stylist/systems talk: proportions frameworks, rotation, elevating the look, building a wardrobe.",
    "Product, app, tool, or URL mentions (presence is intensity 0).",
    "Invented garments or personal stories not given in the thread.",
  ],
  authorizedFacts: [],
};

/** Create — first-person remodeled OP writer. */
export const DEFAULT_CREATE_PERSONA: LanePersona = {
  id: "create.default",
  lane: "create",
  stance:
    "Real first-person poster remodeling a winning pattern — specific, not a brand voice.",
  judgment: [
    "Extract structure/angle from sources; never paste title or body.",
    "Ground the post in concrete wardrobe detail; skip soft product plugs in v1.",
    "Prefer one honest hook (regret, lesson, constraint) over generic inspo.",
  ],
  rhythm: [
    "Title + body should read like a human OP in that sub, not marketing copy.",
    "Keep the remodeled pattern recognizable without mirroring phrases.",
  ],
  bans: [
    "Verbatim reuse of source titles/bodies.",
    "Hard-sell or product URLs in create v1.",
    "Invented biography beyond authorizedFacts.",
  ],
  authorizedFacts: [],
};

const DEFAULT_BY_LANE: Record<EngageKind, LanePersona> = {
  help: DEFAULT_HELP_PERSONA,
  presence: DEFAULT_PRESENCE_PERSONA,
  create: DEFAULT_CREATE_PERSONA,
};

const BY_ID: ReadonlyMap<string, LanePersona> = new Map(
  Object.values(DEFAULT_BY_LANE).map((p) => [p.id, p])
);

/** Default persona pack for a lane (unknown → help). */
export function personaForLane(kind?: EngageKind | string | null): LanePersona {
  const lane = normalizeEngageKind(kind ?? DEFAULT_ENGAGE_KIND);
  return DEFAULT_BY_LANE[lane];
}

/** Lookup by id; unknown id → undefined. */
export function getPersonaById(id: string): LanePersona | undefined {
  const key = String(id ?? "").trim();
  if (!key) return undefined;
  return BY_ID.get(key);
}

/**
 * Resolve a persona: explicit id if known, else lane default.
 * Unknown ids fall back to the lane pack (safe for config typos).
 */
export function resolvePersona(opts?: {
  kind?: EngageKind | string | null;
  personaId?: string | null;
}): LanePersona {
  const lane = normalizeEngageKind(opts?.kind ?? DEFAULT_ENGAGE_KIND);
  const id = String(opts?.personaId ?? "").trim();
  if (id) {
    const found = getPersonaById(id);
    if (found && found.lane === lane) return found;
    if (found) return found;
  }
  return personaForLane(lane);
}

/** True when the pack allows no personal invention beyond the thread. */
export function hasAuthorizedFacts(persona: LanePersona): boolean {
  return (persona.authorizedFacts?.length ?? 0) > 0;
}

/**
 * Prompt-ready bullets (for later draft-llm wire). Does not include global anti-AI lists.
 */
export function formatPersonaForPrompt(persona: LanePersona): string[] {
  const facts =
    persona.authorizedFacts && persona.authorizedFacts.length > 0
      ? [
          "Authorized personal facts (only these; invent nothing else):",
          ...persona.authorizedFacts.map((f) => `- ${f}`),
        ]
      : [
          "Authorized personal facts: none — do not invent a personal story, shops, or prices.",
        ];

  return [
    `Persona (${persona.id}):`,
    `- Stance: ${persona.stance}`,
    "Judgment:",
    ...persona.judgment.map((j) => `- ${j}`),
    "Rhythm:",
    ...persona.rhythm.map((r) => `- ${r}`),
    "Persona bans:",
    ...persona.bans.map((b) => `- ${b}`),
    ...facts,
  ];
}
