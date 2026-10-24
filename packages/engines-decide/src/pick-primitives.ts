/**
 * Catalog-bound primitive picker for Intent → Spec compose.
 *
 * Uses DecisionPort (Jev or heuristic) to select SpecPrimitiveId[] from a
 * free-form goal. Never invents ids outside the catalog. Fail closed if empty
 * after decide (+ safety).
 *
 * See docs/primitives.md — engage-like goals should tend toward
 * observe/read → invoke|navigate → assert → wait_human → write.
 */

import {
  SPEC_PRIMITIVE_IDS,
  ensurePrimitiveSafety,
  type DecisionAnswer,
  type DecisionQuestion,
  type DecisionRequest,
  type SpecPrimitiveId,
} from "@relay/protocol";
import type { DecisionPort } from "./types.js";

export const PRIMITIVE_PICK_META_KIND = "primitive_pick";

const PRIMITIVE_PROMPTS: Record<SpecPrimitiveId, string> = {
  observe:
    "Does this goal need observe (read world state without changing it)?",
  invoke:
    "Does this goal need invoke (call a Spec-shaped capability / tool)?",
  read: "Does this goal need read (fetch a specific artifact or record)?",
  write:
    "Does this goal need write (create or mutate an external artifact — post, email, DB)?",
  navigate:
    "Does this goal need navigate (move focus / open a URL or app surface)?",
  wait_human:
    "Does this goal need wait_human (block for Approve / Edit / Abort)?",
  assert:
    "Does this goal need assert (check acceptance / evidence before acting)?",
};

export type PickPrimitivesOptions = {
  /** Override catalog (tests). Defaults to SPEC_PRIMITIVE_IDS. */
  catalog?: readonly SpecPrimitiveId[];
  /** Floor for overall decide confidence; below → fail closed. Default 0.5. */
  minConfidence?: number;
};

export type PickPrimitivesResult = {
  primitiveIds: SpecPrimitiveId[];
  answer: DecisionAnswer;
  backendName: string;
};

/**
 * Offline keyword suggestion — used by HeuristicDecisionBackend for
 * `meta.kind === primitive_pick` and available for tests.
 * Always returns at least observe + read for a non-empty goal.
 */
export function suggestPrimitivesHeuristic(goal: string): SpecPrimitiveId[] {
  const text = goal.trim();
  if (!text) {
    throw new Error("suggestPrimitivesHeuristic requires a non-empty goal");
  }
  const lower = text.toLowerCase();
  const set = new Set<SpecPrimitiveId>(["observe", "read"]);

  if (
    /\b(post|comment|publish|send|email|write|submit|tweet|reply|replies|respond|draft)\b/.test(
      lower
    )
  ) {
    set.add("write");
  }
  if (
    /\b(browse|open|url|page|reddit|web|navigate|visit|site|browser)\b/.test(
      lower
    )
  ) {
    set.add("navigate");
  }
  if (/\b(api|tool|invoke|call|capability|protocol)\b/.test(lower)) {
    set.add("invoke");
  }
  if (
    /\b(verify|assert|score|gate|check|evidence|acceptance)\b/.test(lower) ||
    set.has("write")
  ) {
    set.add("assert");
  }
  if (
    /\b(approve|hitl|human|review|confirm|negotiate)\b/.test(lower) ||
    set.has("write")
  ) {
    set.add("wait_human");
  }

  return ensurePrimitiveSafety(
    SPEC_PRIMITIVE_IDS.filter((id) => set.has(id))
  );
}

/** Whether heuristic should answer this noul from the primitive keyword map. */
export function heuristicPrimitiveNoulYes(
  primitiveId: string,
  goalText: string
): boolean {
  try {
    return suggestPrimitivesHeuristic(goalText).includes(
      primitiveId as SpecPrimitiveId
    );
  } catch {
    return false;
  }
}

export function buildPrimitivePickRequest(
  goal: string,
  catalog: readonly SpecPrimitiveId[] = SPEC_PRIMITIVE_IDS
): DecisionRequest {
  const trimmed = goal.trim();
  if (!trimmed) {
    throw new Error("pickPrimitivesForGoal requires a non-empty goal");
  }
  const questions: DecisionQuestion[] = catalog.map((id) => ({
    id,
    kind: "noul" as const,
    prompt: PRIMITIVE_PROMPTS[id],
  }));
  return {
    state: { goal: trimmed },
    questions,
    policy: { minConfidence: 0.5 },
    meta: { kind: PRIMITIVE_PICK_META_KIND },
  };
}

/**
 * Ask DecisionPort which catalog primitives belong to this goal.
 * Applies {@link ensurePrimitiveSafety}; fails closed if still empty or
 * confidence below floor.
 */
export async function pickPrimitivesForGoal(
  port: DecisionPort,
  goal: string,
  options: PickPrimitivesOptions = {}
): Promise<PickPrimitivesResult> {
  const catalog = options.catalog ?? SPEC_PRIMITIVE_IDS;
  const minConfidence = options.minConfidence ?? 0.5;
  const request = buildPrimitivePickRequest(goal, catalog);
  const answer = await port.decide(request);

  if (
    !Number.isFinite(answer.confidence) ||
    answer.confidence < minConfidence
  ) {
    throw new Error(
      `Primitive pick confidence too low (${answer.confidence}); fail closed`
    );
  }

  const selected: SpecPrimitiveId[] = [];
  for (const id of catalog) {
    const row = answer.answers[id];
    if (row?.kind === "noul" && row.yes) {
      selected.push(id);
    }
  }

  const primitiveIds = ensurePrimitiveSafety(selected);
  if (primitiveIds.length === 0) {
    throw new Error(
      "Primitive pick selected no catalog primitives (fail closed)"
    );
  }

  return {
    primitiveIds,
    answer,
    backendName: port.backendName,
  };
}
