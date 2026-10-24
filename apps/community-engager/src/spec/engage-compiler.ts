/**
 * CommunityEngager Intent → Spec.
 *
 * Implementation is pack-based compose ({@link composeCommunityIntent}).
 * This module keeps the historical API names for hosts and tests.
 */

import type { Intent, IntentSlots, Spec } from "@relay/protocol";
import {
  composeCommunityFromSlots,
  composeCommunityIntent,
} from "./compose-intent.js";
import {
  COMMUNITY_ENGAGER_APP_ID,
  resolveFeedbackAdapterSlot,
  type EngageCompileOptions,
  type EngageIntentSlotKey,
  type FeedbackAdapterKind,
} from "./engage-slots.js";

export {
  COMMUNITY_ENGAGER_APP_ID,
  resolveFeedbackAdapterSlot,
  type EngageCompileOptions,
  type EngageIntentSlotKey,
  type FeedbackAdapterKind,
};

export type EngageCompileResult = {
  intent: Intent;
  spec: Spec;
  /** Pack that expanded the Intent (compose path). */
  packId?: string;
};

/** Prefer adapter recorded on Spec constraints (from Intent slot). */
export function resolveFeedbackAdapterFromSpec(
  spec: Spec
): FeedbackAdapterKind | undefined {
  const ids = new Set(spec.constraints.map((c) => c.id));
  if (ids.has("hitl_adapter_telegram")) return "telegram";
  if (ids.has("hitl_adapter_cli")) return "cli";
  return undefined;
}

/**
 * Intent → draft Spec for CommunityEngager (compose + engage/post_watch packs).
 * Does not invent stages — binds `procedure` to engage or post_watch manifests.
 */
export function compileEngageIntent(
  intentOrGoal: Intent | string,
  options: EngageCompileOptions = {}
): EngageCompileResult {
  return composeCommunityIntent(intentOrGoal, options);
}

/**
 * Convenience: build Intent from goal + slots, then compose.
 */
export function compileEngageFromSlots(
  goal: string,
  slots: IntentSlots = {},
  options: EngageCompileOptions = {}
): EngageCompileResult {
  return composeCommunityFromSlots(goal, slots, options);
}
