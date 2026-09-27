import { AppController } from "@relay/runtime";
import { StageDefinition, ExecutionEngine, FeedbackResponse } from "@relay/protocol";
import { LLMProvider } from "./provider";

export * from "./provider";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class LLMController implements AppController {
  constructor(private provider: LLMProvider) { }

  private async executeAutonomousLoop(
    stage: StageDefinition, 
    engine: ExecutionEngine, 
    feedback?: FeedbackResponse
  ): Promise<void> {
    console.log(`\n[LLMController] Starting autonomous loop for stage: ${stage.name}`);
    let isComplete = false;
    let iteration = 1;
    const maxIterations = 10;

    while (!isComplete && iteration <= maxIterations) {
      console.log(`[LLMController] Loop Iteration ${iteration}`);
      
      const snapshotResult = await engine.execute({ type: "snapshot", params: {} } as any);
      if (!snapshotResult.success) {
        throw new Error("Engine failed to provide snapshot");
      }

      const { title, url, text } = snapshotResult.data;

      let prompt = `You are an autonomous agent interacting with a browser.
Current Page Title: ${title}
Current URL: ${url}
Visible Text Elements:
${text}

Your goal is to complete the following stage:
Stage Name: ${stage.name}
Goal Description: ${stage.description}

Analyze the UI context above and determine the next actions. 
CRITICAL RULES:
1. If the goal is fully accomplished (you can visually verify success), set isComplete to true.
2. If you are stuck or waiting for user input, DO NOT set isComplete to true. Just generate the actions you CAN do.
3. If you need to navigate to a starting page, generate a "navigate" action.

Available action types: "navigate", "click", "input", "extract".
For "click", "input", and "extract", you MUST provide a "target" using a semantic locator (role + name, placeholder, or exact text).
For "input", you must provide a "value".
For "navigate", you must provide a "url".`;

      if (feedback) {
        prompt += `\n\nYou previously asked the user for feedback because you lacked information. The user has provided the following response:
User Feedback: "${feedback.value}"
Use this feedback to help complete the goal.`;
      }

      const response = await this.provider.generateActions(prompt);
      
      if (response.isComplete) {
        console.log(`[LLMController] LLM declared goal complete! Breaking loop.`);
        isComplete = true;
        break;
      }

      if (!response.actions || response.actions.length === 0) {
        console.log(`[LLMController] LLM generated 0 actions. Pausing loop to allow runtime to ask for feedback.`);
        break;
      }

      console.log(`[LLMController] Generated ${response.actions.length} actions.`);

      for (const action of response.actions) {
        console.log(`[LLMController] Executing action:`, action);
        await engine.execute(action);
      }

      // Wait for DOM to settle after actions before taking next snapshot
      console.log(`[LLMController] Waiting 2000ms for DOM to settle...`);
      await sleep(2000);
      iteration++;
    }

    if (!isComplete) {
      console.log(`[LLMController] Warning: Reached max iterations without completing the goal.`);
    }
  }

  async onStageStart(stage: StageDefinition, engine?: ExecutionEngine): Promise<void> {
    if (!engine) return;
    await this.executeAutonomousLoop(stage, engine);
  }

  async onFeedbackApplied(stage: StageDefinition, feedback: FeedbackResponse, engine?: ExecutionEngine): Promise<void> {
    if (!engine) return;
    await this.executeAutonomousLoop(stage, engine, feedback);
  }
}
