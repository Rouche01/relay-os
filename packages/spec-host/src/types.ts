import type { ApiFixture, ConnectionResolver } from "@relay/engines-api";
import type { LlmClient } from "@relay/llm";
import type {
  AgentContext,
  ExecutionEngine,
  FeedbackRequest,
  FeedbackResponse,
  ServiceDescriptor,
  SpecV2,
  SpecV2Body,
} from "@relay/protocol";
import type { EvalCase, EvalReport } from "@relay/spec-evals";
import type { LoweredWorkflow } from "@relay/spec-lower";
import type { WorkflowEvidenceEntry } from "@relay/workflow-runtime";
import type { AgentRuntime } from "@relay/runtime";

/**
 * Host run modes (h3 will flesh shadow/live).
 * - `fixture` — offline / CI; callers supply apiFixtures + usually blockNetwork
 * - `shadow` — live reads; irreversible writes stay dry-run (default dryRun true)
 * - `live` — writes allowed when budget.dryRun=false (still HITL-gated by Spec)
 */
export type SpecHostMode = "fixture" | "shadow" | "live";

export type SpecHostHitlRespond = (response: {
  action?: FeedbackResponse["action"];
  value?: unknown;
}) => Promise<void>;

export type SpecHostHitlOptions = {
  /**
   * When true, every FEEDBACK_REQUESTED is auto-`proceed`.
   * Default true for fixture CI; Desk / production should pass false (h4).
   */
  autoApprove?: boolean;
  /**
   * Custom HITL handler. If set, takes precedence over autoApprove.
   * Call `respond` to unblock the runtime.
   */
  onFeedbackRequested?: (
    request: FeedbackRequest,
    respond: SpecHostHitlRespond
  ) => void | Promise<void>;
};

export type RunSpecOptions = {
  /** Authoring body — draft+freeze inside the host unless `frozen` is set. */
  body?: SpecV2Body;
  /** Already-frozen Spec — skips draft/freeze (still validates body shape). */
  frozen?: SpecV2;
  /**
   * Full service catalog available to this host process.
   * Host selects descriptors whose ids appear on Spec.services — never hardcodes apps.
   */
  services: readonly ServiceDescriptor[];
  /** Passed to Spec v2 validator (connection refs). */
  knownConnections?: readonly string[];
  /** Resolve Spec connection refs to credentials. Required for non-fixture live/shadow. */
  resolveConnection?: ConnectionResolver;
  /** LLM used by llm.* steps and soft-rule judges. */
  llmClient: LlmClient;
  /**
   * Optional API fixtures (fixture mode / CI). First match wins in engines-api.
   */
  apiFixtures?: readonly ApiFixture[];
  /**
   * Override dry-run for the API engine.
   * Default: Spec budget.dryRun ?? true (never invents live writes).
   */
  dryRun?: boolean;
  /**
   * When true, all fetch attempts throw (CI / Desk offline).
   * Default true in mode `fixture`, false otherwise.
   */
  blockNetwork?: boolean;
  /** Custom fetch implementation (ignored when blockNetwork). */
  fetch?: typeof fetch;
  /** Run mode — shapes defaults for dryRun / blockNetwork. */
  mode?: SpecHostMode;
  hitl?: SpecHostHitlOptions;
  /** Optional evals gate before start; fail closed on gate errors. */
  evals?: {
    cases: readonly EvalCase[];
    softFailClosed?: boolean;
  };
  /** Merge optional engines (browser / computer / custom). */
  extraEngines?: Record<string, ExecutionEngine>;
  /** Agent context overrides (agentId / userId / sessionId required via defaults). */
  context?: Partial<AgentContext> &
    Pick<AgentContext, "agentId" | "userId" | "sessionId">;
  /** Manifest name for lowerer. */
  name?: string;
  frozenBy?: string;
  draftId?: string;
  intentId?: string;
  /** Skip validateSpecV2 (default false). */
  skipValidate?: boolean;
  softFailClosed?: boolean;
  assertRunnable?: boolean | { validate?: boolean };
};

export type RunSpecResult = {
  ok: boolean;
  state: string;
  specId: string;
  specHash: string;
  frozen: SpecV2;
  lowered: LoweredWorkflow;
  evidence: WorkflowEvidenceEntry[];
  evidenceCount: number;
  stepOutputs: Record<string, unknown>;
  stageResults: Record<string, unknown>;
  evalReport?: EvalReport;
  /** Live runtime — callers may attach further listeners (advanced). */
  runtime: AgentRuntime;
};

export type SelectServicesResult =
  | { ok: true; services: ServiceDescriptor[] }
  | { ok: false; missing: string[] };
