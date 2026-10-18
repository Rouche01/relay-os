import {
  createActionStoreFromEnv,
  type ActionStore,
} from "@relay/action-store";
import {
  createContextEngine,
  type ContextEngine,
} from "@relay/context-engine";
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
  type StageDefinition,
} from "@relay/protocol";
import {
  AgentRuntime,
  type FanoutHost,
  type FanoutSummary,
} from "@relay/runtime";
import { CommunityEngagerController } from "./controller.js";
import { createCommunityEngines } from "./engines.js";
import { watchInterstitialCleared } from "./reddit/interstitial/interstitial-watch.js";
import { formatRunSummary, runSummaryFromFanout, type RunSummary } from "./metrics/job-queue.js";
import {
  CommunityEngagerManifest,
  protocolEntrypointName,
  type CommunityEntrypoint,
} from "./manifest.js";
import { getCommunityConfig } from "./reddit/config.js";
import type {
  DiscoverEvidence,
  SessionEvidence,
} from "./metrics/run-evidence.js";
import { writeRunLog } from "./metrics/run-log.js";
import type { ScoutReport } from "./stages/scout/scout-report.js";
import type { CommunityDraft } from "./types.js";

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

    this.controller = new CommunityEngagerController({
      store: this.store,
      memory: this.memory,
      getContext: () => this.runtime.getContext(),
      adapter: options.adapter,
    });

    this.engines = createCommunityEngines({ memory: this.memory });

    this.runtime = new AgentRuntime(
      CommunityEngagerManifest,
      this.engines,
      {
        agentId: options.agentId ?? "community-engager-1",
        userId: options.userId ?? "user-1",
        sessionId: options.sessionId ?? `sess-${Date.now()}`,
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
    });
  }

  async onChildStart(child: AgentRuntime, _item: unknown, index: number): Promise<void> {
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

  /** Run the selected parent manifest end-to-end (fanout included). */
  async run(): Promise<RunSummary> {
    const startedAt = new Date().toISOString();
    const forceDiscover =
      this.entrypoint === "engage" && Boolean(this.options.forceDiscover);
    console.log(
      `[run] entrypoint=${this.entrypoint}` +
        (forceDiscover ? " forceDiscover=1" : "")
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

  private attachBroker(runtime: AgentRuntime): void {
    if (!this.options.adapter || this.brokers.has(runtime)) return;
    const broker = new FeedbackBroker(runtime, {
      adapter: this.options.adapter,
      autoResolvers: [watchInterstitialCleared],
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
    if (this.options.maxJobs != null) return this.options.maxJobs;
    const cfg = getCommunityConfig();
    // Post-watch entrypoint: do not share engage's scout job budget blindly —
    // cap fanout by how many watches we poll per run.
    if (this.entrypoint === "post_watch") {
      return Math.min(cfg.jobs.maxJobs, cfg.postWatch.maxPerRun);
    }
    return cfg.jobs.maxJobs;
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
export * from "./engines.js";
export * from "./metrics/job-queue.js";
export * from "./metrics/run-log.js";
export * from "./metrics/run-evidence.js";
export * from "./stages/scout/scout.js";
export * from "./stages/scout/scout-report.js";
export * from "./stages/draft/drafter.js";
export * from "./stages/execute/executor.js";
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
