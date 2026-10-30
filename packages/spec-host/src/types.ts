import type { ApiFixture, ConnectionResolver } from "@relay/engines-api";
import type { FeedbackAdapter } from "@relay/feedback-broker";
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
import type { SpecRunCheckpoint, RunStateStore } from "./checkpoint.js";
import type { ConnectionStore } from "./connections/types.js";

/**
 * Host run modes:
 * - `fixture` — offline / CI; callers supply apiFixtures + blockNetwork
 * - `shadow` — live reads; irreversible writes always simulated + evidence
 * - `live` — writes only when budget.dryRun=false (HITL still gated by Spec)
 */
export type SpecHostMode = "fixture" | "shadow" | "live";

export type SpecHostHitlRespond = (response: {
  action?: FeedbackResponse["action"];
  value?: unknown;
}) => Promise<void>;

export type SpecHostHitlOptions = {
  /**
   * When true, every FEEDBACK_REQUESTED is auto-`proceed`.
   * Default: true in `fixture`, false in `shadow`/`live` (real HITL expected).
   */
  autoApprove?: boolean;
  /**
   * Custom HITL handler. If set, takes precedence over autoApprove.
   * Call `respond` to unblock the runtime (in-process wait).
   */
  onFeedbackRequested?: (
    request: FeedbackRequest,
    respond: SpecHostHitlRespond
  ) => void | Promise<void>;
  /**
   * Feedback Broker adapter (CLI / Telegram / Desk). When set, the host
   * attaches `@relay/feedback-broker` and blocks until the human responds
   * (unless pauseAndReturn is forced).
   */
  adapter?: FeedbackAdapter;
  /**
   * Persist a checkpoint and return on HITL instead of blocking.
   * Default: true when !autoApprove && !adapter && !onFeedbackRequested.
   */
  pauseAndReturn?: boolean;
  /**
   * Where to save/load run records (pause, terminal complete/abort, Desk list).
   * Required for pauseAndReturn / resume; optional otherwise to persist history.
   */
  runStateStore?: RunStateStore;
  /** Stable run id (generated when omitted). */
  runId?: string;
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
  /**
   * Pluggable secrets store. When set:
   * - `knownConnections` defaults to `store.listIds()`
   * - Spec connection refs are asserted present (fail closed)
   * - `resolveConnection` defaults to the store resolver
   */
  connectionStore?: ConnectionStore;
  /**
   * Passed to Spec v2 validator (connection refs).
   * Defaults from `connectionStore.listIds()` when store is set.
   */
  knownConnections?: readonly string[];
  /**
   * Resolve Spec connection refs to credentials.
   * Prefer `connectionStore`; this overrides when both are set.
   */
  resolveConnection?: ConnectionResolver;
  /**
   * LLM used by llm.* steps and soft-rule judges.
   * Required for `fixture`. For `shadow`/`live`, omit to use env live client
   * (`createLiveLlmClient` / `LLM_PROVIDER` + API key).
   */
  llmClient?: LlmClient;
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
  /**
   * Merge engines (browser / computer / custom).
   * Overrides fixture fallbacks when keys `browser` / `computer` are set.
   */
  extraEngines?: Record<string, ExecutionEngine>;
  /**
   * Install fixture browser + computer engines when not in extraEngines.
   * Default true. Set false to require explicit engines for those verbs.
   */
  fallbackEngines?: boolean;
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
  /** Effective run mode after defaults. */
  mode: SpecHostMode;
  /** Effective API dryRun (true ⇒ irreversible writes simulated). */
  dryRun: boolean;
  /** True when fetch is blocked. */
  blockNetwork: boolean;
  /** Count of dryRunSimulated API write results in step outputs. */
  simulatedWriteCount: number;
  /** Set when paused for HITL (pauseAndReturn). */
  runId?: string;
  checkpoint?: SpecRunCheckpoint;
  pendingFeedback?: FeedbackRequest;
  /** Live runtime — callers may attach further listeners (advanced). */
  runtime: AgentRuntime;
};

export type ResumeSpecOptions = {
  /** Checkpoint object, or load via runId + store. */
  checkpoint?: SpecRunCheckpoint;
  runId?: string;
  runStateStore?: RunStateStore;
  /** Human decision — requestId defaults to checkpoint.pendingFeedback.id. */
  feedback: {
    action?: FeedbackResponse["action"];
    value?: unknown;
    requestId?: string;
    agentId?: string;
  };
  services: readonly ServiceDescriptor[];
  connectionStore?: ConnectionStore;
  knownConnections?: readonly string[];
  resolveConnection?: ConnectionResolver;
  llmClient?: LlmClient;
  apiFixtures?: readonly ApiFixture[];
  dryRun?: boolean;
  blockNetwork?: boolean;
  fetch?: typeof fetch;
  extraEngines?: Record<string, ExecutionEngine>;
  fallbackEngines?: boolean;
  /** If another HITL occurs, pause again (default true when no adapter). */
  hitl?: SpecHostHitlOptions;
  softFailClosed?: boolean;
  assertRunnable?: boolean | { validate?: boolean };
};

export type SelectServicesResult =
  | { ok: true; services: ServiceDescriptor[] }
  | { ok: false; missing: string[] };
