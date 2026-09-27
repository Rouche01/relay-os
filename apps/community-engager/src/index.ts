import { createActionStore, type ActionStore } from "@relay/action-store";
import {
  AgentRuntimeEvent,
  type AgentState,
  type FeedbackRequest,
  type FeedbackResponse,
} from "@relay/protocol";
import { AgentRuntime } from "@relay/runtime";
import { CommunityEngagerController } from "./controller.js";
import { CommunityEngagerManifest } from "./manifest.js";
import { createStubEngine } from "./stub-engine.js";

export interface CommunityEngagerAppOptions {
  store?: ActionStore;
  agentId?: string;
  userId?: string;
  sessionId?: string;
}

export class CommunityEngagerApp {
  private readonly runtime: AgentRuntime;
  private readonly store: ActionStore;
  private readonly controller: CommunityEngagerController;

  constructor(options: CommunityEngagerAppOptions = {}) {
    this.store = options.store ?? createActionStore({ driver: "file" });

    this.controller = new CommunityEngagerController({
      store: this.store,
      getContext: () => this.runtime.getContext(),
    });

    this.runtime = new AgentRuntime(
      CommunityEngagerManifest,
      {
        api: createStubEngine("api"),
        llm: createStubEngine("llm"),
        data: createStubEngine("data"),
      },
      {
        agentId: options.agentId ?? "community-engager-1",
        userId: options.userId ?? "user-1",
        sessionId: options.sessionId ?? `sess-${Date.now()}`,
      },
      this.controller
    );

    this.bindEvents();
  }

  private bindEvents(): void {
    this.runtime.on(AgentRuntimeEvent.STATE_CHANGED, ({ state }: { state: AgentState }) => {
      console.log(`[STATE] ${state}`);
    });

    this.runtime.on(AgentRuntimeEvent.STAGE_STARTED, ({ stage }: { stage: string }) => {
      console.log(`\n[STAGE] ${stage}`);
    });

    this.runtime.on(AgentRuntimeEvent.FEEDBACK_REQUESTED, (req: FeedbackRequest) => {
      if (!req.required) return;
      console.log(`[FEEDBACK] ${req.type}: ${req.prompt}`);
    });

    this.runtime.on(
      AgentRuntimeEvent.FEEDBACK_APPLIED,
      ({ stage, response }: { stage: string; response: FeedbackResponse }) => {
        console.log(
          `[FEEDBACK APPLIED] stage=${stage} action=${response.action ?? "proceed"}`
        );
      }
    );
  }

  getRuntime(): AgentRuntime {
    return this.runtime;
  }

  getStore(): ActionStore {
    return this.store;
  }
}

export * from "./types.js";
export * from "./feedback-map.js";
export * from "./manifest.js";
export * from "./scout.js";
export * from "./drafter.js";
export * from "./executor.js";
