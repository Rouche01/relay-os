import {
  createActionStoreFromEnv,
  type ActionStore,
} from "@relay/action-store";
import {
  createContextEngine,
  type ContextEngine,
} from "@relay/context-engine";
import { ComputerEngine } from "@relay/engines-computer";
import {
  FeedbackBroker,
  type FeedbackAdapter,
} from "@relay/feedback-broker";
import {
  AgentRuntimeEvent,
  type AgentContext,
  type AgentState,
  type ExecutionEngine,
  type FeedbackRequest,
  type FeedbackResponse,
  type Intent,
  type Spec,
  type SpecStore,
  type StageDefinition,
  createSpecBundle,
} from "@relay/protocol";
import {
  AgentRuntime,
  type FanoutHost,
  type FanoutSummary,
} from "@relay/runtime";
import { CommunityEngagerController } from "./controller.js";
import { createCommunityEngines } from "./engines.js";
import { watchInterstitialCleared } from "./reddit/interstitial/interstitial-watch.js";
import { watchComputerChallengeCleared } from "./reddit/write/computer-challenge-watch.js";
import { formatRunSummary, runSummaryFromFanout, type RunSummary } from "./metrics/job-queue.js";
import {
  CommunityEngagerManifest,
  protocolEntrypointName,
  type CommunityEntrypoint,
} from "./manifest.js";
import { getCommunityConfig } from "./reddit/config.js";
import {
  createComputerRunSession,
  engageJobId,
  type ComputerRunSession,
} from "./reddit/write/computer-run-session.js";
import type {
  DiscoverEvidence,
  SessionEvidence,
} from "./metrics/run-evidence.js";
import { writeRunLog } from "./metrics/run-log.js";
import type { ScoutReport } from "./stages/scout/scout-report.js";
import type { CommunityDraft } from "./types.js";
import {
  activateSpecForRun,
  bindingsFromSpec,
  resolveMaxJobs,
} from "./spec/runtime-bind.js";
import { negotiateSpecBeforeRun } from "./spec/hitl-spec.js";

export interface CommunityEngagerAppOptions {
  store?: ActionStore;
  memory?: ContextEngine;
  agentId?: string;
  userId?: string;
  sessionId?: string;
  /**
   * HITL adapter. When provided, the app attaches a FeedbackBroker to the
   * parent runtime and to every fanout child.
   */
  adapter?: FeedbackAdapter;
  /** Max opportunities to process per run (default COMMUNITY_MAX_JOBS, else 3). */
  maxJobs?: number;
  /** Pause between jobs (default COMMUNITY_JOB_DELAY_MS, else 1500ms). */
  jobDelayMs?: number;
  /**
   * Which parent pipeline to run.
   * - `engage` (default): ensure_session → discover → scout → jobs
   * - `post_watch`: post_watch → jobs (follow-ups only; no scout)
   */
  entrypoint?: CommunityEntrypoint;
  /**
   * When true (engage), set `context.forceDiscover` before stages so the
   * discover gate researches even if the allowlist is healthy.
   * Ops `/engage_discover` — does not consume the empty-scout daily ledger.
   */
  forceDiscover?: boolean;
  /**
   * Frozen (or soon-to-run) Spec for this run. Copied onto parent + fanout
   * child contexts so execute fails closed without a complete evidence pack.
   */
  spec?: Spec;
  /**
   * Intent that compiled into `spec` — required with `specStore` to persist
   * after freeze / Spec HITL.
   */
  intent?: Intent;
  /**
   * When set with `intent` + `spec`, persist Intent+Spec after Spec HITL
   * (and on abort) so the run can be replayed by Spec id.
   */
  specStore?: SpecStore;
  /**
   * When true (default if `spec` + `adapter` are set), pause for Spec
   * Approve / Edit / Abort before stages run. Set false to skip.
   */
  specHitl?: boolean;
}

/**
 * Thin host over a nested-manifest runtime.
 * Engage: ensure_session → discover → scout → jobs.
 * Post-watch: post_watch → jobs (separate CLI / future scheduler).
 */
export class CommunityEngagerApp implements FanoutHost {
  private readonly runtime: AgentRuntime;
  private readonly store: ActionStore;
  private readonly memory: ContextEngine;
  private readonly controller: CommunityEngagerController;
  private readonly engines: Record<string, ExecutionEngine>;
  private readonly brokers = new WeakMap<AgentRuntime, FeedbackBroker>();
  private readonly options: CommunityEngagerAppOptions;
  private readonly entrypoint: CommunityEntrypoint;
  /** Shared desktop across preview → HITL → job execute (when computer bound). */
  private readonly computerRun?: ComputerRunSession;

  constructor(options: CommunityEngagerAppOptions = {}) {
    this.options = options;
    this.entrypoint = options.entrypoint ?? "engage";
    this.store = options.store ?? createActionStoreFromEnv();
    this.memory =
      options.memory ??
      createContextEngine({
        agentId: options.agentId ?? "community-engager",
        userId: options.userId,
      });

    this.engines = createCommunityEngines({ memory: this.memory });

    const sessionId = options.sessionId ?? `sess-${Date.now()}`;
    const computerEngine =
      this.engines.computer instanceof ComputerEngine
        ? this.engines.computer
        : undefined;
    this.computerRun = computerEngine
      ? createComputerRunSession({
          engine: computerEngine,
          jobId: engageJobId(sessionId),
          agentId: options.agentId ?? "community-engager",
        })
      : undefined;

    this.controller = new CommunityEngagerController({
      store: this.store,
      memory: this.memory,
      getContext: () => this.runtime.getContext(),
      adapter: options.adapter,
      computerEngine,
      computerRun: this.computerRun,
    });

    this.runtime = new AgentRuntime(
      CommunityEngagerManifest,
      this.engines,
      {
        agentId: options.agentId ?? "community-engager-1",
        userId: options.userId ?? "user-1",
        sessionId,
      },
      this.controller,
      this,
      { entrypoint: protocolEntrypointName(this.entrypoint) }
    );

    this.bindEvents(this.runtime);
  }

  // ── FanoutHost ──────────────────────────────────────────────────────────

  createChildController(
    _stage: StageDefinition,
    item: unknown,
    _index: number,
    getContext: () => AgentContext
  ): CommunityEngagerController {
    return new CommunityEngagerController({
      store: this.store,
      memory: this.memory,
      opportunity: item as CommunityDraft,
      getContext,
      adapter: this.options.adapter,
      computerEngine: this.computerRun?.engine,
      computerRun: this.computerRun,
    });
  }

  async onChildStart(child: AgentRuntime, _item: unknown, index: number): Promise<void> {
    const parentSpec = this.runtime.getContext().spec as Spec | undefined;
    if (parentSpec) {
      child.getContext().spec = parentSpec;
    }
    this.bindEvents(child, `job ${index + 1}`);
    this.attachBroker(child);
  }

  async onChildEnd(child: AgentRuntime): Promise<void> {
    this.detachBroker(child);
  }

  describeItem(item: unknown): string {
    const d = item as CommunityDraft;
    return `r/${d.subreddit ?? "?"} · ${d.id ?? "?"}`;
  }

  resolveFanoutConfig(): { max?: number; delayMs?: number } {
    return { max: this.maxJobs(), delayMs: this.jobDelayMs() };
  }

  getEntrypoint(): CommunityEntrypoint {
    return this.entrypoint;
  }

  /** Persist Intent+Spec when `specStore` + `intent` + `spec` are set. */
  private async persistSpecBundle(spec: Spec | undefined): Promise<void> {
    const store = this.options.specStore;
    const intent = this.options.intent;
    if (!store || !intent || !spec) return;
    try {
      await store.put(
        createSpecBundle(intent, spec, { appId: "community-engager" })
      );
      console.log(
        `[spec-store] saved ${spec.id} v${spec.version} status=${spec.status}`
      );
    } catch (err) {
      console.warn(
        `[spec-store] failed to save ${spec.id}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  /** Run the selected parent manifest end-to-end (fanout included). */
  async run(): Promise<RunSummary> {
    const startedAt = new Date().toISOString();
    try {
      return await this.runInner(startedAt);
    } finally {
      await this.recycleComputerRun();
    }
  }

  private async runInner(startedAt: string): Promise<RunSummary> {
    let runSpec = this.options.spec;
    const wantSpecHitl =
      Boolean(runSpec) &&
      Boolean(this.options.adapter) &&
      this.options.specHitl !== false;

    if (wantSpecHitl && runSpec && this.options.adapter) {
      const negotiated = await negotiateSpecBeforeRun({
        adapter: this.options.adapter,
        spec: runSpec,
        agentId: this.options.agentId ?? "community-engager-1",
        frozenBy: "spec-hitl",
      });
      if (negotiated.aborted) {
        console.warn(`[spec-hitl] ${negotiated.reason}`);
        this.runtime.getContext().spec = negotiated.spec;
        await this.persistSpecBundle(negotiated.spec);
        return {
          runState: "ABORTED",
          scouted: 0,
          skipped: 0,
          jobs: [],
          approved: 0,
          aborted: 0,
          failed: 0,
        };
      }
      runSpec = negotiated.spec;
    }

    await this.persistSpecBundle(runSpec);
    const activeSpec = activateSpecForRun(runSpec);
    const bindings = bindingsFromSpec(activeSpec);
    const forceDiscover =
      this.entrypoint === "engage" &&
      (Boolean(this.options.forceDiscover) || Boolean(bindings?.forceDiscover));
    console.log(
      `[run] entrypoint=${this.entrypoint}` +
        (forceDiscover ? " forceDiscover=1" : "") +
        (activeSpec
          ? ` spec=${activeSpec.id}:${activeSpec.status}` +
            (bindings
              ? ` maxJobs=${bindings.maxJobs ?? "—"} dryRun=${bindings.dryRun ?? "—"} allowPromo=${bindings.allowPromo}`
              : "")
          : "")
    );
    let memoryHealthy: boolean | undefined;
    try {
      memoryHealthy = await this.memory.health();
    } catch {
      memoryHealthy = false;
    }

    if (forceDiscover) {
      this.runtime.getContext().forceDiscover = true;
    }
    if (activeSpec) {
      this.runtime.getContext().spec = activeSpec;
    }

    this.attachBroker(this.runtime);
    try {
      await this.runtime.start();
    } catch (err) {
      console.warn("[run] runtime threw outside the stage loop:", err);
    } finally {
      this.detachBroker(this.runtime);
    }

    const ctx = this.runtime.getContext();
    const opportunities =
      (ctx.opportunities as CommunityDraft[] | undefined) ?? [];
    const fanout = ctx.fanoutSummary as FanoutSummary | undefined;
    const scoutStage = ctx.stageResults?.scout as
      | { report?: ScoutReport }
      | undefined;
    const summary = runSummaryFromFanout(
      opportunities,
      fanout,
      this.runtime.getState(),
      scoutStage?.report,
      {
        session: ctx.stageResults?.ensure_session as SessionEvidence | undefined,
        discover: ctx.stageResults?.discover as DiscoverEvidence | undefined,
      }
    );

    const logPath = await writeRunLog(summary, {
      startedAt,
      agentId: ctx.agentId,
      sessionId: ctx.sessionId,
      memoryName: this.memory.name,
      memoryHealthy,
    });
    if (logPath) {
      console.log(`[run-log] ${logPath}`);
    }

    return summary;
  }

  /** Wipe Firefox / free worker after the engage run (parked or leased). */
  private async recycleComputerRun(): Promise<void> {
    if (!this.computerRun || this.computerRun.isRecycled) return;
    const jobId = this.computerRun.jobId;
    const hadDesktop = Boolean(
      this.computerRun.sessionId ??
        this.computerRun.engine.getSessionId() ??
        this.computerRun.engine.getParkedSessionId()
    );
    const result = await this.computerRun.recycle();
    if (!hadDesktop) return;
    if (!result.ok) {
      console.warn(
        `[computer] recycle failed job_id=${jobId}: ${result.error ?? "unknown"}`
      );
      return;
    }
    console.log(`[computer] recycled desktop job_id=${jobId}`);
  }

  private attachBroker(runtime: AgentRuntime): void {
    if (!this.options.adapter || this.brokers.has(runtime)) return;
    const broker = new FeedbackBroker(runtime, {
      adapter: this.options.adapter,
      autoResolvers: [
        watchInterstitialCleared,
        watchComputerChallengeCleared,
      ],
    });
    broker.attach();
    this.brokers.set(runtime, broker);
  }

  private detachBroker(runtime: AgentRuntime): void {
    const broker = this.brokers.get(runtime);
    if (!broker) return;
    broker.detach();
    this.brokers.delete(runtime);
  }

  private maxJobs(): number {
    const cfg = getCommunityConfig();
    // Post-watch entrypoint: do not share engage's scout job budget blindly —
    // cap fanout by how many watches we poll per run.
    const fallback =
      this.entrypoint === "post_watch"
        ? Math.min(cfg.jobs.maxJobs, cfg.postWatch.maxPerRun)
        : cfg.jobs.maxJobs;
    return resolveMaxJobs({
      spec: (this.runtime.getContext().spec as Spec | undefined) ?? this.options.spec,
      optionMaxJobs: this.options.maxJobs,
      fallback,
    });
  }

  private jobDelayMs(): number {
    if (this.options.jobDelayMs != null) return this.options.jobDelayMs;
    return getCommunityConfig().jobs.delayMs;
  }

  private bindEvents(runtime: AgentRuntime, label?: string): void {
    if ((runtime as { __communityEventsBound?: boolean }).__communityEventsBound) {
      return;
    }
    (runtime as { __communityEventsBound?: boolean }).__communityEventsBound = true;

    const tag = label ? `${label} ` : "";

    runtime.on(AgentRuntimeEvent.STATE_CHANGED, ({ state }: { state: AgentState }) => {
      console.log(`[STATE] ${tag}${state}`);
    });

    runtime.on(AgentRuntimeEvent.STAGE_STARTED, ({ stage }: { stage: string }) => {
      console.log(`\n[STAGE] ${tag}${stage}`);
    });

    runtime.on(AgentRuntimeEvent.FEEDBACK_REQUESTED, (req: FeedbackRequest) => {
      if (!req.required) return;
      console.log(`[FEEDBACK] ${req.type}: ${req.prompt}`);
    });

    runtime.on(
      AgentRuntimeEvent.FEEDBACK_APPLIED,
      ({ stage, response }: { stage: string; response: FeedbackResponse }) => {
        console.log(
          `[FEEDBACK APPLIED] ${tag}stage=${stage} action=${response.action ?? "proceed"}`
        );
      }
    );

    runtime.on(AgentRuntimeEvent.ERROR, (err: unknown) => {
      console.warn(`[ERROR] ${tag}${err instanceof Error ? err.message : String(err)}`);
    });
  }

  getRuntime(): AgentRuntime {
    return this.runtime;
  }

  getStore(): ActionStore {
    return this.store;
  }

  getMemory(): ContextEngine {
    return this.memory;
  }
}

export { formatRunSummary };

export * from "./types.js";
export * from "./decide/feedback-map.js";
export * from "./manifest.js";
export * from "./spec/index.js";
export * from "./engines.js";
export * from "./metrics/job-queue.js";
export * from "./metrics/run-log.js";
export * from "./metrics/run-evidence.js";
export * from "./stages/scout/scout.js";
export * from "./stages/scout/scout-report.js";
export * from "./stages/draft/drafter.js";
export * from "./stages/execute/executor.js";
export * from "./stages/execute/manual-notify.js";
export * from "./memory.js";
export * from "./policy/allowlist-store.js";
export * from "./stages/discover/discover.js";
export * from "./reddit/config.js";
export * from "./reddit/session/cookies.js";
export * from "./reddit/session/browser-login.js";
export * from "./reddit/session/browser-session.js";
export * from "./reddit/write/browser-comment.js";
export * from "./reddit/session/credentials.js";
export * from "./reddit/interstitial/interstitial.js";
export * from "./reddit/scout/discover-subs.js";
export * from "./reddit/scout/scout-json.js";
export * from "./reddit/scout/scout-redditapis.js";
export * from "./reddit/redditapis/index.js";
