/**
 * Intent → capability slots + candidates (cs2).
 * Needs[] only when a matched slot has zero viable candidates.
 */

import {
  CAPABILITY_VOCAB_SEED,
  matchCapabilityVocab,
  preferredLiveOrFirst,
  slotHasViableCandidate,
  withCandidateStatus,
  type BindingCandidate,
  type BindingCandidateStatus,
  type BindingCandidateTemplate,
  type CapabilitySlot,
  type CapabilityVocabEntry,
  type ServiceDescriptor,
} from "@relay/protocol";
import type { ScaffoldNeed } from "./needs.js";

export type ProposeSlotsOptions = {
  intent: string;
  catalog: readonly ServiceDescriptor[];
  knownConnections?: readonly string[];
  vocab?: readonly CapabilityVocabEntry[];
};

/** Build unresolved slots from intent vocabulary matches. */
export function proposeSlotsFromIntent(
  options: ProposeSlotsOptions
): CapabilitySlot[] {
  const matched = matchCapabilityVocab(
    options.intent,
    options.vocab ?? CAPABILITY_VOCAB_SEED
  );
  const byId = new Map(options.catalog.map((s) => [s.id, s]));
  const known =
    options.knownConnections !== undefined
      ? new Set(options.knownConnections)
      : null;

  return matched.map((entry) => {
    const candidates = entry.defaultCandidates.map((t) =>
      annotateCandidate(t, byId, known)
    );
    return {
      id: entry.id,
      needs: [...entry.needs],
      candidates,
      resolved: null,
      preferredCandidateIndex: preferredLiveOrFirst(candidates),
    };
  });
}

/** Needs only when a slot has no non-blocked candidates. */
export function needsFromCapabilitySlots(
  slots: readonly CapabilitySlot[]
): ScaffoldNeed[] {
  const out: ScaffoldNeed[] = [];
  const seen = new Set<string>();
  for (const slot of slots) {
    if (slotHasViableCandidate(slot)) continue;
    const key = `capability:${slot.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const blocked = slot.candidates
      .filter((c) => c.status === "blocked")
      .map((c) => c.service ?? c.binding)
      .join(", ");
    out.push({
      kind: "capability",
      id: slot.id,
      reason: blocked
        ? `Capability ${JSON.stringify(slot.id)} has no viable binding (blocked: ${blocked})`
        : `Capability ${JSON.stringify(slot.id)} has no viable binding candidates`,
      action: "resolve_slot",
    });
  }
  return out;
}

/** Attach / replace slots on a Spec body from intent + catalog. */
export function withSlotsFromIntent(
  body: import("@relay/protocol").SpecV2Body,
  options: ProposeSlotsOptions
): import("@relay/protocol").SpecV2Body {
  const slots = proposeSlotsFromIntent(options);
  if (!slots.length) {
    const { slots: _drop, ...rest } = body as typeof body & {
      slots?: CapabilitySlot[];
    };
    void _drop;
    return rest;
  }
  return { ...body, slots };
}

function annotateCandidate(
  template: BindingCandidateTemplate,
  catalog: ReadonlyMap<string, ServiceDescriptor>,
  known: ReadonlySet<string> | null
): BindingCandidate {
  if (!template.service) {
    return withCandidateStatus(
      template,
      template.defaultStatus ?? "available"
    );
  }

  const desc = catalog.get(template.service);
  if (!desc) {
    return withCandidateStatus(template, "blocked");
  }

  if (template.defaultStatus === "degraded") {
    return withCandidateStatus(template, "degraded");
  }

  if (
    template.connection &&
    known &&
    !known.has(template.connection)
  ) {
    return withCandidateStatus(template, "unknown");
  }

  if (template.connection && desc.auth && desc.auth.type !== "none") {
    // Connection-shaped auth present in descriptor; known unset → treat unknown
    if (known === null) {
      return withCandidateStatus(template, "unknown");
    }
  }

  return withCandidateStatus(template, statusOrLive(template.defaultStatus));
}

function statusOrLive(
  fallback?: BindingCandidateStatus
): BindingCandidateStatus {
  if (fallback === "blocked") return "blocked";
  if (fallback === "degraded") return "degraded";
  if (fallback === "available") return "available";
  return "live";
}
