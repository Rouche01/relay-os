import { createActionStore, type ActionStore } from "@relay/action-store";
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
import { formatRunSummary, runSummaryFromFanout, type RunSummary } from "./job-queue.js";
import { CommunityEngagerManifest } from "./manifest.js";
import type { CommunityDraft } from "./types.js";

const DEFAULT_MAX_JOBS = 3;
const DEFAULT_JOB_DELAY_MS = 1_500;

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
}

/**
 * Thin host over a nested-manifest runtime.
 * Parent stages: ensure_session → scout → jobs (fanout → CommunityJobManifest).
 */
export class CommunityEngagerApp implements FanoutHost {
  private readonly runtime: AgentRuntime;
  private readonly store: ActionStore;
  private readonly memory: ContextEngine;
  private readonly controller: CommunityEngagerController;
  private readonly engines: Record<string, ExecutionEngine>;
  private readonly brokers = new WeakMap<AgentRuntime, FeedbackBroker>();
  private readonly options: CommunityEngagerAppOptions;

  constructor(options: CommunityEngagerAppOptions = {}) {
    this.options = options;
    this.store = options.store ?? createActionStore({ driver: "file" });
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
      this
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

  /** Run the nested parent manifest end-to-end (fanout included). */
  async run(): Promise<RunSummary> {
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
    const summary = runSummaryFromFanout(
      opportunities,
      fanout,
      this.runtime.getState()
    );
    return summary;
  }

  private attachBroker(runtime: AgentRuntime): void {
    if (!this.options.adapter || this.brokers.has(runtime)) return;
    const broker = new FeedbackBroker(runtime, {
      adapter: this.options.adapter,
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
    const fromEnv = Number(process.env.COMMUNITY_MAX_JOBS);
    return (
      this.options.maxJobs ??
      (Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_MAX_JOBS)
    );
  }

  private jobDelayMs(): number {
    const fromEnv = Number(process.env.COMMUNITY_JOB_DELAY_MS);
    return (
      this.options.jobDelayMs ??
      (Number.isFinite(fromEnv) && fromEnv >= 0 ? fromEnv : DEFAULT_JOB_DELAY_MS)
    );
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
export * from "./feedback-map.js";
export * from "./manifest.js";
export * from "./engines.js";
export * from "./job-queue.js";
export * from "./scout.js";
export * from "./drafter.js";
export * from "./executor.js";
export * from "./memory.js";
export * from "./allowlist-store.js";
export * from "./discover.js";
export * from "./reddit/config.js";
export * from "./reddit/cookies.js";
export * from "./reddit/browser-login.js";
export * from "./reddit/browser-session.js";
export * from "./reddit/browser-comment.js";
export * from "./reddit/credentials.js";
export * from "./reddit/interstitial.js";
export * from "./reddit/discover-subs.js";
export * from "./reddit/scout-json.js";
