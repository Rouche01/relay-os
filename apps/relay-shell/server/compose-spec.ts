/**
 * Shell Spec create path: decide primitives → composeFromPrimitives → bundle.
 * Additive — does not touch CommunityEngager manifests.
 */
import {
  createDecisionPort,
  pickPrimitivesForGoal,
  type DecideBackendName,
} from "@relay/engines-decide";
import {
  SPEC_PRIMITIVE_IDS,
  composeFromPrimitives,
  composeIntentFromSlots,
  createSpecBundle,
  type IntentSlots,
  type SpecBundle,
  type SpecPrimitiveId,
} from "@relay/protocol";
import { relayComposePack } from "./generic-pack.js";

const PRIMITIVE_SET = new Set<string>(SPEC_PRIMITIVE_IDS);

export type ComposeSpecBody = {
  goal?: string;
  slots?: IntentSlots;
  /** Skip decide; use these catalog ids (tests / explicit override). */
  primitiveIds?: string[];
  /**
   * `primitives` (default) — decide + composeFromPrimitives.
   * `pack` — legacy fixed relay/compose pack (escape hatch).
   */
  composeMode?: "primitives" | "pack";
};

export type ComposeSpecResult = SpecBundle & {
  packId: string;
  primitiveIds: SpecPrimitiveId[];
  decideBackend: string | null;
};

function resolveComposeMode(
  body: ComposeSpecBody
): "primitives" | "pack" {
  if (body.composeMode === "pack" || body.composeMode === "primitives") {
    return body.composeMode;
  }
  const env = process.env.RELAY_SHELL_COMPOSE?.trim().toLowerCase();
  if (env === "pack") return "pack";
  return "primitives";
}

export async function composeAndBundleSpec(
  body: ComposeSpecBody
): Promise<ComposeSpecResult> {
  const goal =
    body.goal?.trim() || "Compose a Spec from Intent under HITL";
  const slots: IntentSlots = body.slots ?? { dryRun: true, maxJobs: 2 };
  const mode = resolveComposeMode(body);

  if (mode === "pack") {
    const { intent, spec, packId } = composeIntentFromSlots(goal, slots, {
      packs: [relayComposePack],
    });
    const bundle = createSpecBundle(intent, spec, { appId: "relay" });
    const primitiveIds = spec.allowedActions
      .map((a) => a.id)
      .filter((id): id is SpecPrimitiveId => PRIMITIVE_SET.has(id));
    return {
      ...bundle,
      packId,
      primitiveIds,
      decideBackend: null,
    };
  }

  let primitiveIds: SpecPrimitiveId[];
  let decideBackend: string | null = null;

  if (body.primitiveIds?.length) {
    primitiveIds = body.primitiveIds as SpecPrimitiveId[];
  } else {
    const backend = (process.env.DECIDE_BACKEND?.trim().toLowerCase() ||
      "heuristic") as DecideBackendName;
    const port = createDecisionPort({
      backend: backend === "jev" ? "jev" : "heuristic",
    });
    const picked = await pickPrimitivesForGoal(port, goal);
    primitiveIds = picked.primitiveIds;
    decideBackend = picked.backendName;
  }

  const { intent, spec, packId } = composeFromPrimitives({
    goal,
    primitiveIds,
    slots,
  });
  const bundle = createSpecBundle(intent, spec, { appId: "relay" });

  return {
    ...bundle,
    packId,
    primitiveIds: spec.allowedActions.map((a) => a.id as SpecPrimitiveId),
    decideBackend,
  };
}
