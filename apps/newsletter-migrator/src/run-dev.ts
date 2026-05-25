import { NewsletterMigratorApp } from "./index";
import * as readline from "readline";
import { FeedbackRequest, AgentRuntimeEvent } from "@relay/protocol";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(query: string): Promise<string> {
  return new Promise(resolve => rl.question(query, resolve));
}

async function run() {
  console.log("=== Booting Relay OS App: Newsletter Migrator (Interactive) ===");
  const app = new NewsletterMigratorApp();
  const runtime = app.getRuntime();

  // Hook up the terminal prompt to the runtime's feedback request
  runtime.on(AgentRuntimeEvent.FEEDBACK_REQUESTED, async (req: FeedbackRequest) => {
    console.log(`\n=== FEEDBACK REQUIRED: ${req.type.toUpperCase()} ===`);
    console.log(req.prompt);

    const answer = await askQuestion("> ");

    runtime.provideFeedback({
      requestId: req.id,
      agentId: req.agentId,
      value: answer
    });
  });

  console.log("Triggering Agent Start...");
  await runtime.start();

  console.log("\n=== Workflow Complete ===");
  rl.close();
  process.exit(0);
}

run();
