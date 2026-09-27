import "dotenv/config";
import { FeedbackBroker, CliFeedbackAdapter } from "@relay/feedback-broker";
import {
  createTelegramAdapterFromEnv,
  TelegramFeedbackAdapter,
} from "@relay/adapters-telegram";
import { CommunityEngagerApp } from "./index.js";

async function main(): Promise<void> {
  console.log("=== Relay · CommunityEngager (dev) ===\n");

  const app = new CommunityEngagerApp();
  const runtime = app.getRuntime();
  const memory = app.getMemory();
  const healthy = await memory.health();
  console.log(
    `Memory: ${memory.name}${healthy ? " (sidecar ok)" : " (unavailable / fail-open)"}\n`
  );

  const useTelegram = process.env.FEEDBACK_ADAPTER === "telegram";
  let telegram: TelegramFeedbackAdapter | undefined;

  const adapter = useTelegram
    ? ((telegram = createTelegramAdapterFromEnv()), telegram)
    : new CliFeedbackAdapter();

  if (telegram) {
    telegram.start();
    console.log("Feedback adapter: telegram (allowlisted user only)\n");
  } else {
    console.log("Feedback adapter: cli  (approve | abort | edit: …)\n");
    console.log("Set FEEDBACK_ADAPTER=telegram for Telegram HITL.\n");
  }

  const broker = new FeedbackBroker(runtime, { adapter });
  broker.attach();

  try {
    await runtime.start();
    console.log(`\n=== Done · state=${runtime.getState()} ===`);
  } finally {
    broker.detach();
    if (telegram) await telegram.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
