import "dotenv/config";
import { CliFeedbackAdapter } from "@relay/feedback-broker";
import {
  createTelegramAdapterFromEnv,
  TelegramFeedbackAdapter,
} from "@relay/adapters-telegram";
import { CommunityEngagerApp } from "./index.js";
import { formatRunSummary } from "./job-queue.js";

async function main(): Promise<void> {
  console.log("=== Relay · CommunityEngager (dev) ===\n");

  const useTelegram = process.env.FEEDBACK_ADAPTER === "telegram";
  let telegram: TelegramFeedbackAdapter | undefined;

  const adapter = useTelegram
    ? ((telegram = createTelegramAdapterFromEnv()), telegram)
    : new CliFeedbackAdapter();

  const app = new CommunityEngagerApp({ adapter });
  const memory = app.getMemory();
  const healthy = await memory.health();
  console.log(
    `Memory: ${memory.name}${healthy ? " (sidecar ok)" : " (unavailable / fail-open)"}\n`
  );

  if (telegram) {
    telegram.start();
    console.log("Feedback adapter: telegram (allowlisted user only)\n");
  } else {
    console.log("Feedback adapter: cli  (approve | abort | edit: …)\n");
    console.log("Set FEEDBACK_ADAPTER=telegram for Telegram HITL.\n");
  }

  try {
    const summary = await app.run();
    console.log(`\n=== Run summary ===\n${formatRunSummary(summary)}`);
  } finally {
    if (telegram) await telegram.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
