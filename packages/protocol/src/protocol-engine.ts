/**
 * Spec-native protocol engine (sketch).
 *
 * Preferred path when the world is Spec-addressable: declare → invoke / observe
 * → evidence against the same Spec types as the browser fallback.
 *
 * This module is a **port + in-memory stub**, not a full capability runtime.
 * See docs/protocol-engine.md.
 */

import {
  evaluateSpecEvidence,
  type EvidenceObservation,
  type EvidencePhase,
  type SpecEvidencePack,
} from "./evidence";
import type { EngineResult } from "./engines";
import type { ActionBinding, SideEffectClass, Spec } from "./spec";

/** Domain-free primitive ids (catalog v0 — docs/primitives.md). */
export type SpecPrimitiveId =
  | "observe"
  | "invoke"
  | "read"
  | "write"
  | "navigate"
  | "wait_human"
  | "assert";

export const SPEC_PRIMITIVE_IDS: readonly SpecPrimitiveId[] = [
  "observe",
  "invoke",
  "read",
  "write",
  "navigate",
  "wait_human",
  "assert",
] as const;

/** A Spec-shaped capability the protocol engine can invoke. */
export interface ProtocolCapability {
  id: string;
  /** Which primitive this capability implements. */
  primitive: SpecPrimitiveId;
  sideEffect: SideEffectClass;
  description?: string;
}

export type ProtocolAction = {
  /** Must be allowed by Spec.allowedActions (or map to a primitive id). */
  actionId: string;
  primitive: SpecPrimitiveId;
  params?: Record<string, unknown>;
  /**
   * Capability id when primitive is `invoke`.
   * Stub records it; real engines dispatch to registered capabilities.
   */
  capabilityId?: string;
};

export type ProtocolObserveQuery = {
  /** Free-form query key for the stub (e.g. resource id). */
  query: string;
  params?: Record<string, unknown>;
};

export type ProtocolObservation = {
  query: string;
  /** Stub returns empty data; real engines fill world state. */
  data: Record<string, unknown>;
  at: string;
};

export type ProtocolResult = EngineResult & {
  /** Echo of the action for demos / tests. */
  actionId?: string;
  primitive?: SpecPrimitiveId;
  /** True when Spec.budget.dryRun skipped an irreversible commit. */
  dryRunSimulated?: boolean;
};

export interface ProtocolSession {
  readonly spec: Spec;
  readonly binding: ActionBinding;

  /**
   * Run a primitive under this Spec. Refuses actions not in allowedActions
   * (by actionId or primitive id). Irreversible + dryRun → simulate only.
   */
  invoke(action: ProtocolAction): Promise<ProtocolResult>;

  /** Read-only observe (always sideEffect none). */
  observe(query: ProtocolObserveQuery): Promise<ProtocolObservation>;

  /**
   * Evaluate Spec acceptance for a phase using accumulated observations.
   * Call {@link recordEvidence} first for each acceptance id.
   */
  evidence(phase: EvidencePhase): SpecEvidencePack;

  /** Record an observation for an acceptance item (feeds evidence). */
  recordEvidence(acceptanceId: string, obs: EvidenceObservation): void;

  teardown(): Promise<void>;
}

export interface ProtocolEngine {
  /**
   * Bind a frozen (or running) Spec. Draft Specs are refused — freeze first.
   */
  declare(spec: Spec): Promise<ProtocolSession>;
}

function actionAllowed(spec: Spec, actionId: string, primitive: SpecPrimitiveId): boolean {
  return spec.allowedActions.some(
    (a) => a.id === actionId || a.id === primitive
  );
}

function sideEffectFor(
  spec: Spec,
  actionId: string,
  primitive: SpecPrimitiveId
): SideEffectClass {
  const hit = spec.allowedActions.find(
    (a) => a.id === actionId || a.id === primitive
  );
  if (hit) return hit.sideEffect;
  if (primitive === "write") return "irreversible";
  if (primitive === "invoke") return "reversible";
  return "none";
}

/**
 * In-memory protocol engine stub — proves Spec gating without I/O.
 * Not for production CommunityEngager runs (those still use browser).
 */
export class ProtocolEngineStub implements ProtocolEngine {
  constructor(
    private readonly capabilities: ProtocolCapability[] = []
  ) {}

  async declare(spec: Spec): Promise<ProtocolSession> {
    if (spec.status !== "frozen" && spec.status !== "running") {
      throw new Error(
        `ProtocolEngine.declare requires frozen|running Spec (got ${spec.status})`
      );
    }
    return new ProtocolSessionStub(spec, this.capabilities);
  }
}

class ProtocolSessionStub implements ProtocolSession {
  readonly binding: ActionBinding = "protocol";
  private readonly evidenceObs: Record<string, EvidenceObservation> = {};
  private tornDown = false;

  constructor(
    readonly spec: Spec,
    private readonly capabilities: ProtocolCapability[]
  ) {}

  private ensureOpen(): void {
    if (this.tornDown) {
      throw new Error("ProtocolSession is torn down");
    }
  }

  async invoke(action: ProtocolAction): Promise<ProtocolResult> {
    this.ensureOpen();
    if (!SPEC_PRIMITIVE_IDS.includes(action.primitive)) {
      return {
        success: false,
        error: `Unknown primitive: ${action.primitive}`,
        actionId: action.actionId,
        primitive: action.primitive,
      };
    }
    if (!actionAllowed(this.spec, action.actionId, action.primitive)) {
      return {
        success: false,
        error: `Action not allowed by Spec: ${action.actionId} (${action.primitive})`,
        actionId: action.actionId,
        primitive: action.primitive,
      };
    }

    if (action.primitive === "wait_human") {
      return {
        success: true,
        data: { deferred: "wait_human — use FeedbackBroker / Spec HITL" },
        actionId: action.actionId,
        primitive: action.primitive,
        feedback_required: undefined,
      };
    }

    if (action.primitive === "assert") {
      const acceptanceId =
        (typeof action.params?.acceptanceId === "string"
          ? action.params.acceptanceId
          : action.actionId) ?? "";
      const pack = this.evidence("pre_execute");
      const item = pack.items.find((i) => i.acceptanceId === acceptanceId);
      const ok = item?.status === "satisfied";
      return {
        success: ok,
        data: { pack, acceptanceId },
        error: ok ? undefined : `assert failed: ${acceptanceId}`,
        actionId: action.actionId,
        primitive: action.primitive,
      };
    }

    if (action.primitive === "navigate") {
      return {
        success: true,
        data: {
          note: "navigate is a no-op under protocol (address capabilities by id)",
          params: action.params ?? {},
        },
        actionId: action.actionId,
        primitive: action.primitive,
      };
    }

    if (action.primitive === "invoke" && action.capabilityId) {
      const cap = this.capabilities.find((c) => c.id === action.capabilityId);
      if (!cap) {
        return {
          success: false,
          error: `Unknown capability: ${action.capabilityId}`,
          actionId: action.actionId,
          primitive: action.primitive,
        };
      }
    }

    const side = sideEffectFor(this.spec, action.actionId, action.primitive);
    if (side === "irreversible" && this.spec.budget.dryRun) {
      return {
        success: true,
        dryRunSimulated: true,
        data: {
          simulated: true,
          actionId: action.actionId,
          params: action.params ?? {},
        },
        actionId: action.actionId,
        primitive: action.primitive,
      };
    }

    return {
      success: true,
      data: {
        stub: true,
        actionId: action.actionId,
        primitive: action.primitive,
        capabilityId: action.capabilityId,
        params: action.params ?? {},
      },
      actionId: action.actionId,
      primitive: action.primitive,
    };
  }

  async observe(query: ProtocolObserveQuery): Promise<ProtocolObservation> {
    this.ensureOpen();
    return {
      query: query.query,
      data: { stub: true, params: query.params ?? {} },
      at: new Date().toISOString(),
    };
  }

  recordEvidence(acceptanceId: string, obs: EvidenceObservation): void {
    this.ensureOpen();
    this.evidenceObs[acceptanceId] = obs;
  }

  evidence(phase: EvidencePhase): SpecEvidencePack {
    this.ensureOpen();
    return evaluateSpecEvidence(this.spec, phase, this.evidenceObs);
  }

  async teardown(): Promise<void> {
    this.tornDown = true;
  }
}

/** Convenience: create the sketch stub (optionally with capabilities). */
export function createProtocolEngineStub(
  capabilities?: ProtocolCapability[]
): ProtocolEngine {
  return new ProtocolEngineStub(capabilities);
}
