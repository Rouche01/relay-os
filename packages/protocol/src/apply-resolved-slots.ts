/**
 * Runtime slot → binding apply (cs4).
 * Spec law (goal/rules/step ids) stays; service/connection/use follow Ship resolution.
 */

import type { BindingCandidate, CapabilitySlot } from "./capability-slots.js";
import type { SpecV2Body, SpecV2Step } from "./spec-v2.js";

export type ResolvedSlotMap = ReadonlyMap<string, BindingCandidate>;

export type ApplyResolvedSlotsResult =
  | {
      ok: true;
      body: SpecV2Body;
      resolutions: ResolvedSlotMap;
      /** Steps that referenced a slot and were rewritten. */
      rewrittenStepIds: string[];
    }
  | { ok: false; errors: string[] };

/** Candidate chosen at Ship — preferred index when resolved is set. */
export function getResolvedCandidate(
  slot: CapabilitySlot
): BindingCandidate | undefined {
  if (slot.resolved == null || slot.resolved === "") return undefined;
  const idx = slot.preferredCandidateIndex;
  if (
    typeof idx === "number" &&
    Number.isInteger(idx) &&
    idx >= 0 &&
    idx < slot.candidates.length
  ) {
    return slot.candidates[idx];
  }
  // Fallback: match connection / synthetic resolved string
  const byConnection = slot.candidates.find(
    (c) => c.connection && c.connection === slot.resolved
  );
  if (byConnection) return byConnection;
  const bySynthetic = slot.candidates.find((c) => {
    const syn = c.service
      ? `${c.service}:slot`
      : `binding:${c.binding}`;
    return syn === slot.resolved;
  });
  return bySynthetic;
}

/**
 * Map binding → engine use id for steps that declare `args.slot`.
 * Prefer keeping a compatible use; otherwise remap so Ship can swap
 * official → degraded → computer → human without rewriting Spec law.
 */
function useForBinding(
  binding: BindingCandidate["binding"],
  currentUse: string
): { use: string } | { error: string } {
  switch (binding) {
    case "api":
    case "notify":
    case "mcp":
      return { use: "api.request" };
    case "human":
      if (currentUse.startsWith("human.")) return { use: currentUse };
      return { use: "human.edit" };
    case "browser":
      if (currentUse.startsWith("browser.")) return { use: currentUse };
      return { use: "browser.navigate" };
    case "computer":
      if (currentUse.startsWith("computer.")) return { use: currentUse };
      return { use: "computer.observe" };
    default:
      return { error: `unsupported binding ${JSON.stringify(binding)}` };
  }
}

/**
 * Apply Ship-resolved slots onto a Spec body for a run.
 * - Steps with `args.slot` get service/connection/use from the resolved candidate.
 * - Unresolved slot refs fail closed.
 * - Bodies with slots but no step slot refs are unchanged (ASAP / sidecar slots).
 */
export function applyResolvedSlots(body: SpecV2Body): ApplyResolvedSlotsResult {
  const slots = body.slots ?? [];
  if (!slots.length) {
    return {
      ok: true,
      body,
      resolutions: new Map(),
      rewrittenStepIds: [],
    };
  }

  const byId = new Map(slots.map((s) => [s.id, s]));
  const resolutions = new Map<string, BindingCandidate>();
  const errors: string[] = [];
  const rewrittenStepIds: string[] = [];

  const stepsNeedSlots = body.steps.some((step) => {
    const args = step.args as Record<string, unknown> | undefined;
    return typeof args?.slot === "string" && args.slot.trim().length > 0;
  });

  if (!stepsNeedSlots) {
    // Slots present for Ship UX only — do not block ASAP concrete steps.
    for (const slot of slots) {
      const cand = getResolvedCandidate(slot);
      if (cand) resolutions.set(slot.id, cand);
    }
    return {
      ok: true,
      body: mergeServicesConnections(body, resolutions),
      resolutions,
      rewrittenStepIds: [],
    };
  }

  for (const slot of slots) {
    const cand = getResolvedCandidate(slot);
    if (cand) resolutions.set(slot.id, cand);
  }

  const nextSteps: SpecV2Step[] = body.steps.map((step) => {
    const args = (step.args ?? {}) as Record<string, unknown>;
    const slotId = typeof args.slot === "string" ? args.slot.trim() : "";
    if (!slotId) return step;

    const slot = byId.get(slotId);
    if (!slot) {
      errors.push(
        `steps.${step.id}: unknown capability slot ${JSON.stringify(slotId)}`
      );
      return step;
    }
    const candidate = resolutions.get(slotId);
    if (!candidate) {
      errors.push(
        `steps.${step.id}: slot ${JSON.stringify(slotId)} is not resolved — pick a binding on Ship`
      );
      return step;
    }
    if (candidate.status === "blocked") {
      errors.push(
        `steps.${step.id}: slot ${JSON.stringify(slotId)} resolved to a blocked candidate`
      );
      return step;
    }

    const mapped = useForBinding(candidate.binding, step.use);
    if ("error" in mapped) {
      errors.push(
        `steps.${step.id}: slot ${JSON.stringify(slotId)} — ${mapped.error}`
      );
      return step;
    }

    const nextArgs: Record<string, unknown> = { ...args, slot: slotId };
    if (mapped.use === "api.request") {
      if (!candidate.service) {
        errors.push(
          `steps.${step.id}: slot ${JSON.stringify(slotId)} binding ${candidate.binding} has no service`
        );
        return step;
      }
      nextArgs.service = candidate.service;
      if (candidate.connection) {
        nextArgs.connection = candidate.connection;
      } else {
        delete nextArgs.connection;
      }
    } else {
      delete nextArgs.service;
      delete nextArgs.connection;
      if (mapped.use === "human.edit" || mapped.use === "human.approve") {
        if (nextArgs.show === undefined) {
          nextArgs.show =
            nextArgs.query ??
            `Operator input for capability slot ${slotId}`;
        }
      }
      if (mapped.use === "browser.navigate" && nextArgs.url === undefined) {
        errors.push(
          `steps.${step.id}: slot ${JSON.stringify(slotId)} browser binding needs args.url`
        );
        return step;
      }
    }

    rewrittenStepIds.push(step.id);
    return {
      ...step,
      use: mapped.use,
      args: nextArgs,
    };
  });

  if (errors.length) return { ok: false, errors };

  const nextBody = mergeServicesConnections(
    { ...body, steps: nextSteps },
    resolutions
  );
  return {
    ok: true,
    body: nextBody,
    resolutions,
    rewrittenStepIds,
  };
}

function mergeServicesConnections(
  body: SpecV2Body,
  resolutions: ResolvedSlotMap
): SpecV2Body {
  const services = new Set(body.services ?? []);
  const connections = new Set(body.connections ?? []);
  for (const cand of resolutions.values()) {
    if (cand.service) services.add(cand.service);
    if (cand.connection) connections.add(cand.connection);
  }
  return {
    ...body,
    services: services.size ? [...services] : body.services,
    connections: connections.size ? [...connections] : body.connections,
  };
}
