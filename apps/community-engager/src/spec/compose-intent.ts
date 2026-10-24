import {
  composeIntent,
  composeIntentFromSlots,
  type Intent,
  type IntentSlots,
  type Spec,
} from "@relay/protocol";
import {
  type EngageCompileOptions,
} from "./engage-slots.js";
import {
  communityEngagerPacks,
  type CommunityComposeDefaults,
} from "./packs/community-engager-packs.js";

export type ComposeCommunityResult = {
  intent: Intent;
  spec: Spec;
  packId: string;
};

/**
 * Compose Intent → draft Spec via CommunityEngager domain packs
 * (engage | post_watch). Universal entry; packs expand to primitives + aliases.
 */
export function composeCommunityIntent(
  intentOrGoal: Intent | string,
  options: EngageCompileOptions = {}
): ComposeCommunityResult {
  const { intent, spec, packId } = composeIntent(intentOrGoal, {
    packs: communityEngagerPacks,
    defaults: options.defaults as CommunityComposeDefaults | undefined,
    specId: options.specId,
    intentId: options.intentId,
  });
  return { intent, spec, packId };
}

/** Convenience: goal + slots → compose via CommunityEngager packs. */
export function composeCommunityFromSlots(
  goal: string,
  slots: IntentSlots = {},
  options: EngageCompileOptions = {}
): ComposeCommunityResult {
  const { intent, spec, packId } = composeIntentFromSlots(goal, slots, {
    packs: communityEngagerPacks,
    defaults: options.defaults as CommunityComposeDefaults | undefined,
    specId: options.specId,
    intentId: options.intentId,
  });
  return { intent, spec, packId };
}
