import { AgentRuntime, AppController } from "@relay/runtime";
import { PlaywrightEngine, BrowserEngineAction } from "@relay/engines-browser";
import { FeedbackResponse, AgentState, FeedbackRequest, ExecutionEngine, AgentRuntimeEvent, StageDefinition } from "@relay/protocol";
import { NewsletterMigratorManifest } from "./manifest";

export class NewsletterMigratorApp {
  private runtime: AgentRuntime;
  private engine: PlaywrightEngine;
  private controller: AppController;

  constructor() {
    this.engine = new PlaywrightEngine({ headless: false });

    this.controller = {
      onStageStart: async (stage: StageDefinition, engine: ExecutionEngine) => {
        if (stage.name === "LOGIN") {
          console.log("[ACTION] Navigating to Substack login...");
          await engine.execute({
            type: "navigate",
            params: { url: "https://substack.com/sign-in" }
          } as BrowserEngineAction);
        } else if (stage.name === "SELECT_LIST") {
          console.log("[ACTION] Navigating to Substack settings...");
          // Log for demo
        }
      },
      onFeedbackApplied: async (stage: StageDefinition, response: FeedbackResponse, engine: ExecutionEngine) => {
        if (stage.name === "LOGIN" && response.value.includes("@")) {
          const parts = response.value.trim().split(/\s+/);
          const email = parts[0];

          try {
            console.log(`[ACTION] Filling semantic locator { placeholder: "Email" } with ${email}`);
            await engine.execute({
              type: "input",
              params: {
                target: { placeholder: "Email" },
                value: email
              }
            } as BrowserEngineAction);

            console.log(`[ACTION] Clicking submit button ("Continue")`);
            await engine.execute({
              type: "click",
              params: {
                target: { role: "button", name: "Continue" }
              }
            } as BrowserEngineAction);
          } catch (e) {
            console.error("Error performing login actions in browser:", e);
          }
        } else if (stage.name === "VERIFY_OTP") {
          const otpCode = response.value.trim();
          try {
            console.log(`[ACTION] Filling semantic locator { placeholder: "000000" } with OTP code`);
            await engine.execute({
              type: "input",
              params: {
                target: { placeholder: "000000" },
                value: otpCode
              }
            } as BrowserEngineAction);
          } catch (e) {
            console.error("Error performing OTP verification in browser:", e);
          }
        }
      }
    };

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
