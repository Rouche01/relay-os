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

/** Pack id stamped on Specs built via {@link composeFromPrimitives}. */
export const PRIMITIVES_COMPOSE_PACK_ID = "relay/primitives";

const PRIMITIVE_META: Record<
  SpecPrimitiveId,
  { description: string; sideEffect: SpecAllowedAction["sideEffect"] }
> = {
  observe: { description: "Observe world state without changing it", sideEffect: "none" },
  invoke: {
    description: "Invoke a Spec-shaped capability / tool",
    sideEffect: "reversible",
  },
  read: { description: "Fetch a specific artifact or record", sideEffect: "none" },
  write: {
    description: "Create or mutate an external artifact",
    sideEffect: "irreversible",
  },
  navigate: {
    description: "Move focus / context (URL, app surface)",
    sideEffect: "none",
  },
  wait_human: {
    description: "Block for Approve / Edit / Abort",
    sideEffect: "none",
  },
  assert: {
    description: "Check an acceptance / evidence item",
    sideEffect: "none",
  },
};

export type ComposeFromPrimitivesOptions = {
  goal: string;
  /** Catalog ids only; unknown ids fail closed. */
  primitiveIds: readonly string[];
  /** Budget slots (maxJobs, dryRun) and opaque Intent slots. */
  slots?: IntentSlots;
  intentId?: string;
  specId?: string;
  /** Defaults to `{ appId: "relay", entrypoint: "compose" }`. */
  procedure?: SpecProcedure;
  actionBinding?: ActionBinding;
};

/**
 * Normalize + validate catalog primitive ids.
 * Dedupes (first wins), rejects unknowns, fails closed on empty.
 */
export function normalizePrimitiveIds(
  ids: readonly string[]
): SpecPrimitiveId[] {
  const out: SpecPrimitiveId[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = raw.trim();
    if (!id) continue;
    if (!PRIMITIVE_SET.has(id)) {
      throw new Error(
        `Unknown Spec primitive "${id}" (catalog: ${SPEC_PRIMITIVE_IDS.join(", ")})`
      );
    }
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id as SpecPrimitiveId);
  }
  if (out.length === 0) {
    throw new Error(
      "composeFromPrimitives requires at least one Spec primitive (fail closed)"
    );
  }
  return out;
}

/**
 * Ensure HITL / assert when irreversible primitives are present.
 * Additive only — never removes caller-chosen ids.
 */
export function ensurePrimitiveSafety(
  ids: readonly SpecPrimitiveId[]
): SpecPrimitiveId[] {
  const set = new Set(ids);
  const hasIrreversible = ids.some(
    (id) => PRIMITIVE_META[id].sideEffect === "irreversible"
  );
  if (hasIrreversible) {
    set.add("wait_human");
    set.add("assert");
  }
  // Stable order: catalog order, not insertion order of safety adds.
  return SPEC_PRIMITIVE_IDS.filter((id) => set.has(id));
}

function slotNumber(
  slots: IntentSlots | undefined,
  key: string,
  fallback: number
): number {
  const v = slots?.[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function slotBool(
  slots: IntentSlots | undefined,
  key: string,
  fallback: boolean
): boolean {
  const v = slots?.[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "1" || v === "true") return true;
  if (v === 0 || v === "0" || v === "false") return false;
  return Boolean(v);
}

/**
 * Catalog-only compose: goal + chosen primitives → draft Spec.
 *
 * Does not invent unbound action ids or manifests. Domain packs remain a
 * parallel path ({@link composeIntent}). Additive safety: irreversible
 * primitives force `wait_human` + `assert`.
 */
export function composeFromPrimitives(
  options: ComposeFromPrimitivesOptions
): ComposeIntentResult {
  const goal = options.goal.trim();
  if (!goal) {
    throw new Error("composeFromPrimitives requires a non-empty goal");
  }

  const chosen = ensurePrimitiveSafety(
    normalizePrimitiveIds(options.primitiveIds)
  );
  const slots = options.slots ?? {};
  const maxJobs = slotNumber(slots, "maxJobs", 3);
  const dryRun = slotBool(slots, "dryRun", true);
  const hasIrreversible = chosen.some(
    (id) => PRIMITIVE_META[id].sideEffect === "irreversible"
  );

  const allowedActions: SpecAllowedAction[] = chosen.map((id) => ({
    id,
    description: PRIMITIVE_META[id].description,
    sideEffect: PRIMITIVE_META[id].sideEffect,
  }));

  const constraints: SpecConstraint[] = [
    {
      id: "hitl_before_irreversible",
      description: "Negotiate before irreversible write",
    },
  ];
  if (dryRun) {
    constraints.push({
      id: "dry_run_default",
      description: "dryRun: simulate irreversible acts",
    });
  }

  const hitlRequired: SpecHitlRequirement[] = [
    {
      id: "before_run",
      description: "Approve Spec before treating it as law",
      when: "before_run",
    },
  ];
  if (hasIrreversible) {
    hitlRequired.push({
      id: "before_irreversible",
      description: "HITL before irreversible primitive",
      when: "before_irreversible",
    });
  }

  const acceptance: SpecAcceptanceItem[] = [
    {
      id: "intent_captured",
      description: "Intent goal recorded on Spec",
      kind: "gate",
    },
    {
      id: "human_freeze",
      description: "Human Approve / Abort via Spec UI or adapter",
      kind: "human",
    },
  ];
  if (chosen.includes("assert")) {
    acceptance.push({
      id: "asserts_evaluated",
      description: "Assert primitives checked against evidence when required",
      kind: "gate",
    });
  }

  const expansion: ComposeExpansion = {
    goal,
    procedure: options.procedure ?? {
      appId: "relay",
      entrypoint: "compose",
    },
    actionBinding: options.actionBinding ?? "protocol",
    constraints,
    allowedActions,
    acceptance,
    hitlRequired,
    budget: { maxJobs, dryRun },
  };

  if (!expansionUsesPrimitives(expansion)) {
    throw new Error(
      "composeFromPrimitives produced no Spec primitives (fail closed)"
    );
  }

  const intent = createIntent({
    goal,
    slots,
    id: options.intentId,
  });

  const spec = createDraftSpec({
    id: options.specId,
    intentId: intent.id,
    goal: expansion.goal,
    procedure: expansion.procedure,
    actionBinding: expansion.actionBinding,
    constraints: withPackConstraint(
      expansion.constraints ?? [],
      PRIMITIVES_COMPOSE_PACK_ID
    ),
    allowedActions: expansion.allowedActions,
    acceptance: expansion.acceptance,
    hitlRequired: expansion.hitlRequired,
    budget: expansion.budget,
  });

  return {
    intent: markIntentCompiled(intent, spec.id),
    spec,
    packId: PRIMITIVES_COMPOSE_PACK_ID,
  };
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
