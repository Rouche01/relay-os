import { createActionStore, type ActionStore } from "@relay/action-store";
import {
  createContextEngine,
  type ContextEngine,
} from "@relay/context-engine";
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
  memory?: ContextEngine;
  agentId?: string;
  userId?: string;
  sessionId?: string;
}

export class CommunityEngagerApp {
  private readonly runtime: AgentRuntime;
  private readonly store: ActionStore;
  private readonly memory: ContextEngine;
  private readonly controller: CommunityEngagerController;

  constructor(options: CommunityEngagerAppOptions = {}) {
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

    this.runtime = new AgentRuntime(
      CommunityEngagerManifest,
      {
        api: createStubEngine("api"),
        llm: createStubEngine("llm"),
        data: createStubEngine("data"),
        browser: createStubEngine("browser"),
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

  getMemory(): ContextEngine {
    return this.memory;
  }
}

export * from "./types.js";
export * from "./feedback-map.js";
export * from "./manifest.js";
export * from "./scout.js";
export * from "./drafter.js";
export * from "./executor.js";
export * from "./memory.js";
export * from "./reddit/config.js";
export * from "./reddit/cookies.js";
export * from "./reddit/browser-login.js";
export * from "./reddit/browser-session.js";
export * from "./reddit/browser-comment.js";
export * from "./reddit/credentials.js";
export * from "./reddit/scout-json.js";
