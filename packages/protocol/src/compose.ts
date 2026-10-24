/**
 * Universal Intent → Spec compose (catalog-bound).
 *
 * One compose function; domain packs expand Intent into Spec fields.
 * Packs may only emit primitives from the catalog (+ documented aliases).
 * Unmatched Intent fails closed — no free-form stage invention.
 *
 * See docs/primitives.md.
 */

import {
  createIntent,
  markIntentCompiled,
  type Intent,
  type IntentSlots,
} from "./intent";
import {
  SPEC_PRIMITIVE_IDS,
  type SpecPrimitiveId,
} from "./protocol-engine";
import {
  createDraftSpec,
  type ActionBinding,
  type Spec,
  type SpecAcceptanceItem,
  type SpecAllowedAction,
  type SpecBudget,
  type SpecConstraint,
  type SpecHitlRequirement,
  type SpecProcedure,
} from "./spec";

export { SPEC_PRIMITIVE_IDS, type SpecPrimitiveId };

/** Opaque defaults a pack may read (app-specific; protocol does not interpret). */
export type ComposeDefaults = Record<string, unknown>;

/**
 * Fields a domain pack contributes to a draft Spec.
 * `allowedActions` should include Spec primitives and optional pack aliases.
 */
export type ComposeExpansion = {
  goal: string;
  procedure: SpecProcedure;
  actionBinding?: ActionBinding;
  constraints?: SpecConstraint[];
  allowedActions: SpecAllowedAction[];
  acceptance: SpecAcceptanceItem[];
  hitlRequired?: SpecHitlRequirement[];
  budget?: SpecBudget;
};

/**
 * Domain pack — optional recipe that expands Intent into Spec fields.
 * Not a separate product compiler; registered with {@link composeIntent}.
 */
export type DomainPack = {
  /** Stable id, e.g. `community-engager/engage`. */
  id: string;
  /** Whether this pack claims the Intent (first match wins). */
  match: (intent: Intent, defaults?: ComposeDefaults) => boolean;
  /** Expand Intent → Spec field bag (catalog-bound). */
  expand: (intent: Intent, defaults?: ComposeDefaults) => ComposeExpansion;
};

export type ComposeIntentOptions = {
  /** Packs to try in order; first {@link DomainPack.match} wins. */
  packs: DomainPack[];
  /** Opaque defaults forwarded to pack match/expand. */
  defaults?: ComposeDefaults;
  /** Override Spec id (tests). */
  specId?: string;
  /** When composing from a goal string, Intent id override. */
  intentId?: string;
};

export type ComposeIntentResult = {
  intent: Intent;
  spec: Spec;
  /** Pack that produced the Spec. */
  packId: string;
};

const PRIMITIVE_SET = new Set<string>(SPEC_PRIMITIVE_IDS);

/**
 * True when every allowed action is a known primitive id or carries
 * `actionBinding` (pack aliases are allowed; unbound fiction is not required
 * to be detected here — packs own alias ids).
 *
 * Soft check: at least one primitive id should appear when `requirePrimitive`
 * is true (default).
 */
export function expansionUsesPrimitives(
  expansion: ComposeExpansion,
  opts?: { requirePrimitive?: boolean }
): boolean {
  const requirePrimitive = opts?.requirePrimitive ?? true;
  if (expansion.allowedActions.length === 0) return false;
  const hasPrimitive = expansion.allowedActions.some((a) =>
    PRIMITIVE_SET.has(a.id)
  );
  if (requirePrimitive && !hasPrimitive) return false;
  return true;
}

/**
 * Compose Intent → draft Spec via the first matching domain pack.
 * Throws if no pack matches or expansion has no acceptance / no primitives.
 */
export function composeIntent(
  intentOrGoal: Intent | string,
  options: ComposeIntentOptions
): ComposeIntentResult {
  if (!options.packs?.length) {
    throw new Error("composeIntent requires at least one domain pack");
  }

  const intent: Intent =
    typeof intentOrGoal === "string"
      ? createIntent({
          goal: intentOrGoal,
          id: options.intentId,
          slots: {},
        })
      : intentOrGoal;

  if (intent.status === "abandoned") {
    throw new Error("Cannot compose an abandoned Intent");
  }

  const defaults = options.defaults;
  const pack = options.packs.find((p) => p.match(intent, defaults));
  if (!pack) {
    throw new Error(
      `No domain pack matched Intent ${intent.id} (goal=${JSON.stringify(intent.goal.slice(0, 80))}). ` +
        `Catalog-bound compose refuses unbound invention.`
    );
  }

  const expansion = pack.expand(intent, defaults);
  if (!expansion.acceptance?.length) {
    throw new Error(
      `Pack ${pack.id} produced empty acceptance (fail closed before freeze)`
    );
  }
  if (!expansionUsesPrimitives(expansion)) {
    throw new Error(
      `Pack ${pack.id} must include at least one Spec primitive in allowedActions ` +
        `(${SPEC_PRIMITIVE_IDS.join(", ")})`
    );
  }

  const spec = createDraftSpec({
    id: options.specId,
    intentId: intent.id,
    goal: expansion.goal,
    procedure: expansion.procedure,
    actionBinding: expansion.actionBinding,
    constraints: withPackConstraint(expansion.constraints ?? [], pack.id),
    allowedActions: expansion.allowedActions,
    acceptance: expansion.acceptance,
    hitlRequired: expansion.hitlRequired,
    budget: expansion.budget,
  });

  return {
    intent: markIntentCompiled(intent, spec.id),
    spec,
    packId: pack.id,
  };
}

/** Convenience: Intent from goal + slots, then compose. */
export function composeIntentFromSlots(
  goal: string,
  slots: IntentSlots,
  options: ComposeIntentOptions
): ComposeIntentResult {
  const intent = createIntent({
    goal,
    slots,
    id: options.intentId,
  });
  return composeIntent(intent, options);
}

function withPackConstraint(
  constraints: SpecConstraint[],
  packId: string
): SpecConstraint[] {
  if (constraints.some((c) => c.id === "compose_pack")) {
    return constraints.map((c) =>
      c.id === "compose_pack"
        ? { id: "compose_pack", description: packId }
        : c
    );
  }
  return [
    {
      id: "compose_pack",
      description: packId,
    },
    ...constraints,
  ];
}
