import { AgentRuntime, AppController } from "@relay/runtime";
import { PlaywrightEngine, BrowserEngineAction } from "@relay/engines-browser";
import { FeedbackResponse, AgentState, FeedbackRequest, ExecutionEngine, AgentRuntimeEvent, StageDefinition } from "@relay/protocol";
import { LLMController, GeminiProvider } from "@relay/llm-controller";
import { NewsletterMigratorManifest } from "./manifest";

export class NewsletterMigratorApp {
  private runtime: AgentRuntime;
  private engine: PlaywrightEngine;
  private controller: AppController;

  constructor() {
    this.engine = new PlaywrightEngine({ headless: false });

    const provider = new GeminiProvider();
    this.controller = new LLMController(provider);

    this.runtime = new AgentRuntime(
      NewsletterMigratorManifest,
      { browser: this.engine },
      { agentId: "newsletter-migrator-1", userId: "user-1", sessionId: "sess-1" },
      this.controller
    );

    this.bindEvents();
  }

  private bindEvents() {
    this.runtime.on(AgentRuntimeEvent.STATE_CHANGED, ({ state }: { state: AgentState }) => {
      console.log(`[STATE] Agent moved to: ${state}`);
    });

    this.runtime.on(AgentRuntimeEvent.STAGE_STARTED, ({ stage }: { stage: string }) => {
      console.log(`\n[STAGE] Starting stage: ${stage}`);
    });

    this.runtime.on(AgentRuntimeEvent.FEEDBACK_REQUESTED, (req: FeedbackRequest) => {
      console.log(`\n[FEEDBACK REQUIRED] Type: ${req.type}`);
      console.log(`[PROMPT] ${req.prompt}`);
    });

    this.runtime.on(AgentRuntimeEvent.FEEDBACK_APPLIED, async ({ stage, response }: { stage: string; response: FeedbackResponse }) => {
      console.log(`[FEEDBACK APPLIED] Resuming stage ${stage} with user input: ${response.value}`);
    });
  }

  public getRuntime(): AgentRuntime {
    return this.runtime;
  }
}
