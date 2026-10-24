/**
 * Spec — human-owned authority for what an agent may do and what “done” means.
 *
 * Intent compiles into a Spec (draft). Freeze pins the brief. The agent may
 * replan *inside* a frozen Spec; widening constraints requires thaw.
 *
 * Manifests describe *how* stages run. Specs authorize *what* is allowed and
 * how acceptance is proved. Spec.procedure points at an app entrypoint;
 * Spec does not replace StageDefinition.
 *
 * Engines: prefer Spec-native protocol when the system is addressable;
 * browser / computer-use is the fallback for GUI-only surfaces. Same Spec
 * binds both via action_binding (whole Spec or per allowed action).
 */

/** Lifecycle of a Spec. */
export type SpecStatus =
  | "draft"
  | "frozen"
  | "running"
  | "satisfied"
  | "aborted";

/**
 * How an action is carried out under this Spec.
 * - `protocol` — Spec-shaped invoke/observe (preferred when available)
 * - `browser` — GUI / computer-use compatibility path
 */
export type ActionBinding = "protocol" | "browser";

/** Side-effect class — irreversible actions must stay behind HITL when Spec says so. */
export type SideEffectClass = "none" | "reversible" | "irreversible";

/** How an acceptance item is checked for the evidence pack. */
export type AcceptanceKind = "artifact" | "gate" | "human";

export interface SpecConstraint {
  id: string;
  description: string;
}

export interface SpecAllowedAction {
  id: string;
  description: string;
  sideEffect: SideEffectClass;
  /** Overrides Spec-level default when set. */
  actionBinding?: ActionBinding;
}

export interface SpecAcceptanceItem {
  id: string;
  description: string;
  kind: AcceptanceKind;
}

/**
 * When negotiation is required (not only “approve the draft”).
 * Examples: `before_freeze`, `before_irreversible`, `on_acceptance_human`.
 */
export interface SpecHitlRequirement {
  id: string;
  description: string;
  /** Machine-oriented cue for runtime (e.g. before_irreversible). */
  when: string;
}

export interface SpecBudget {
  /** Max fanout / child jobs for this run. */
  maxJobs?: number;
  /** Default dry-run until human flips or Spec says otherwise. */
  dryRun?: boolean;
  /** Soft wall-clock budget for the whole Spec run (ms). */
  timeoutMs?: number;
}

/** Which agentic procedure this Spec authorizes. */
export interface SpecProcedure {
  /** App id (e.g. community-engager). */
  appId: string;
  /** Entrypoint name (e.g. engage, post_watch). */
  entrypoint: string;
}

export interface Spec {
  id: string;
  /** Bumps on thaw+edit that change meaning; freeze pins a version. */
  version: number;
  status: SpecStatus;

  /** Intent this Spec was compiled from, when known. */
  intentId?: string;

  goal: string;
  constraints: SpecConstraint[];
  allowedActions: SpecAllowedAction[];
  acceptance: SpecAcceptanceItem[];
  hitlRequired: SpecHitlRequirement[];
  budget: SpecBudget;

  /** Default binding for actions that omit their own. */
  actionBinding: ActionBinding;

  procedure: SpecProcedure;

  createdAt: string;
  frozenAt?: string;
  /** Who froze (user id, telegram id, "cli", etc.). */
  frozenBy?: string;
  /** Optional stable fingerprint of frozen contents for audit. */
  contentHash?: string;
}

export type CreateDraftSpecInput = {
  goal: string;
  procedure: SpecProcedure;
  intentId?: string;
  constraints?: SpecConstraint[];
  allowedActions?: SpecAllowedAction[];
  acceptance?: SpecAcceptanceItem[];
  hitlRequired?: SpecHitlRequirement[];
  budget?: SpecBudget;
  actionBinding?: ActionBinding;
  /** Caller-supplied id; otherwise generated. */
  id?: string;
  createdAt?: string;
};

function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Create a draft Spec ready for human review / freeze. */
export function createDraftSpec(input: CreateDraftSpecInput): Spec {
  const goal = input.goal.trim();
  if (!goal) {
    throw new Error("Spec goal must be non-empty");
  }
  if (!input.procedure?.appId?.trim() || !input.procedure?.entrypoint?.trim()) {
    throw new Error("Spec procedure requires appId and entrypoint");
  }

  return {
    id: input.id ?? newId("spec"),
    version: 1,
    status: "draft",
    intentId: input.intentId,
    goal,
    constraints: input.constraints ?? [],
    allowedActions: input.allowedActions ?? [],
    acceptance: input.acceptance ?? [],
    hitlRequired: input.hitlRequired ?? [],
    budget: input.budget ?? {},
    actionBinding: input.actionBinding ?? "browser",
    procedure: {
      appId: input.procedure.appId.trim(),
      entrypoint: input.procedure.entrypoint.trim(),
    },
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

/**
 * Pin a draft Spec as authority. Rejects empty acceptance when
 * `requireAcceptance` is true (default).
 */
export function freezeSpec(
  spec: Spec,
  opts?: { frozenBy?: string; requireAcceptance?: boolean; contentHash?: string }
): Spec {
  if (spec.status !== "draft") {
    throw new Error(`Cannot freeze Spec in status "${spec.status}" (need draft)`);
  }
  const requireAcceptance = opts?.requireAcceptance ?? true;
  if (requireAcceptance && spec.acceptance.length === 0) {
    throw new Error("Cannot freeze Spec with empty acceptance (fail closed)");
  }

  return {
    ...spec,
    status: "frozen",
    frozenAt: new Date().toISOString(),
    frozenBy: opts?.frozenBy,
    contentHash: opts?.contentHash ?? spec.contentHash,
  };
}

/**
 * Re-open a frozen Spec for edits. Bumps version; clears freeze metadata.
 * Running / terminal Specs cannot be thawed.
 */
export function thawSpec(spec: Spec): Spec {
  if (spec.status !== "frozen") {
    throw new Error(`Cannot thaw Spec in status "${spec.status}" (need frozen)`);
  }
  return {
    ...spec,
    status: "draft",
    version: spec.version + 1,
    frozenAt: undefined,
    frozenBy: undefined,
    contentHash: undefined,
  };
}

/** Mark frozen Spec as in progress. */
export function markSpecRunning(spec: Spec): Spec {
  if (spec.status !== "frozen") {
    throw new Error(`Cannot run Spec in status "${spec.status}" (need frozen)`);
  }
  return { ...spec, status: "running" };
}

/** Terminal: acceptance proved and irreversible work finished (or dry-run complete). */
export function markSpecSatisfied(spec: Spec): Spec {
  if (spec.status !== "running" && spec.status !== "frozen") {
    throw new Error(
      `Cannot satisfy Spec in status "${spec.status}" (need running or frozen)`
    );
  }
  return { ...spec, status: "satisfied" };
}

/** Terminal: human aborted or policy stopped the run. */
export function markSpecAborted(spec: Spec): Spec {
  if (spec.status === "satisfied" || spec.status === "aborted") {
    throw new Error(`Spec already terminal ("${spec.status}")`);
  }
  return { ...spec, status: "aborted" };
}

/** Effective binding for an allowed action. */
export function resolveActionBinding(
  spec: Spec,
  action: SpecAllowedAction
): ActionBinding {
  return action.actionBinding ?? spec.actionBinding;
}
