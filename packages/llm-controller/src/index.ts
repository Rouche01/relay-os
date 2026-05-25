import { AppController } from "@relay/runtime";
import { StageDefinition, ExecutionEngine, FeedbackResponse } from "@relay/protocol";
import { LLMProvider } from "./provider";

export * from "./provider";

export class LLMController implements AppController {
  constructor(private provider: LLMProvider) { }

  async onStageStart(stage: StageDefinition, engine: ExecutionEngine): Promise<void> {
    const snapshotResult = await engine.execute({ type: "snapshot", params: {} } as any);
    if (!snapshotResult.success) {
      throw new Error("Engine failed to provide snapshot");
    }

    const { title, url, text } = snapshotResult.data;

    const prompt = `You are an autonomous agent interacting with a browser.
Current Page Title: ${title}
Current URL: ${url}
Visible Text Elements:
${text}

Your goal is to complete the following stage:
Stage Name: ${stage.name}
Goal Description: ${stage.description}

Analyze the UI context above and generate a JSON array of actions to accomplish the goal.
Available action types: "navigate", "click", "input", "extract".
For "click", "input", and "extract", you MUST provide a "target" using a semantic locator (role + name, placeholder, or exact text).
For "input", you must provide a "value".
For "navigate", you must provide a "url".`;

    const actions = await this.provider.generateActions(prompt);
    console.log(`\n[LLMController] Generated ${actions.length} actions for stage ${stage.name}`);

    for (const action of actions) {
      console.log(`[LLMController] Executing action:`, action);
      await engine.execute(action);
    }
  }

  async onFeedbackApplied(stage: StageDefinition, feedback: FeedbackResponse, engine: ExecutionEngine): Promise<void> {
    const snapshotResult = await engine.execute({ type: "snapshot", params: {} } as any);
    const { title, url, text } = snapshotResult.data;

    const prompt = `You are an autonomous agent interacting with a browser.
Current Page Title: ${title}
Current URL: ${url}
Visible Text Elements:
${text}

Your goal is to complete the following stage:
Stage Name: ${stage.name}
Goal Description: ${stage.description}

You previously asked the user for feedback because you lacked information. The user has provided the following response:
User Feedback: "${feedback.value}"

Use the user's feedback to complete the goal. Generate a JSON array of actions.`;

    const actions = await this.provider.generateActions(prompt);
    console.log(`\n[LLMController] Generated ${actions.length} actions after feedback for stage ${stage.name}`);

    for (const action of actions) {
      console.log(`[LLMController] Executing action:`, action);
      await engine.execute(action);
    }
  }
}
