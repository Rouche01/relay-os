/**
 * Experimental LLM phone-policy dogfood.
 *
 * Default goal: open Telegram → channel/chat "Amsterdam" → ❤️ on latest message.
 *
 *   COMPUTER_GATEWAY_URL=http://localhost:9000 \
 *   COMPUTER_API_TOKEN=dev-token \
 *   GEMINI_API_KEY=… \
 *   pnpm --filter @relay/phone-policy dogfood:phone-browse
 *
 * Requires a free phone seat + vision LLM key. Soft-parks by default.
 * Fixed-step Settings path stays: `pnpm --filter @relay/engines-computer dogfood:phone`.
 */
import { ComputerEngine } from "@relay/engines-computer";
import { createLlmClient, parseLlmProviderId } from "@relay/llm";
import {
  createLlmPhoneDecider,
  defaultPhoneTiming,
  runPhonePolicyLoop,
} from "../src/index.js";

const DEFAULT_GOAL = `Open the Telegram app. Find and open the chat or channel named "Amsterdam". On the most recent message in that chat, add a love/heart reaction (❤️). Stop with kind "done" only when that heart reaction is clearly visible on the latest message. If Telegram asks for login, 2FA, or you cannot find Amsterdam, use kind "need_human". Prefer launch for Telegram, swipe to scroll chats, long_press a message then tap the heart reaction. Use key back/home only when needed.`;

const DEFAULT_TELEGRAM_PACKAGE = "org.telegram.messenger";

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v || undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(argv: string[]) {
  let recycle = false;
  let pauseMs = Number(env("PHONE_BROWSE_PAUSE_MS") ?? "4000");
  let maxSteps = Number(env("PHONE_BROWSE_MAX_STEPS") ?? "25");
  let goal = env("PHONE_BROWSE_GOAL") ?? DEFAULT_GOAL;
  let telegramPackage =
    env("PHONE_BROWSE_TELEGRAM_PACKAGE") ?? DEFAULT_TELEGRAM_PACKAGE;
  let skipLaunch = false;
  let exitRateMu = Number(env("PHONE_BROWSE_EXIT_MU") ?? "0");

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") continue;
    if (a === "--recycle") recycle = true;
    else if (a === "--skip-launch") skipLaunch = true;
    else if (a === "--pause-ms" && argv[i + 1]) pauseMs = Number(argv[++i]);
    else if (a === "--max-steps" && argv[i + 1]) maxSteps = Number(argv[++i]);
    else if (a === "--goal" && argv[i + 1]) goal = argv[++i]!;
    else if (a === "--telegram-package" && argv[i + 1]) {
      telegramPackage = argv[++i]!;
    } else if (a === "--help" || a === "-h") {
      console.log(`Usage: phone-browse-dogfood [options]

Options:
  --goal <text>              Override the phone goal
  --max-steps <n>            Max policy iterations (default 25)
  --pause-ms <n>             Pause after lease for Watch (default 4000)
  --telegram-package <pkg>   Package to launch first (default ${DEFAULT_TELEGRAM_PACKAGE})
  --skip-launch              Do not pre-launch Telegram (model must launch)
  --recycle                  Recycle seat instead of soft-park

Env:
  COMPUTER_GATEWAY_URL, COMPUTER_API_TOKEN
  GEMINI_API_KEY or ANTHROPIC_API_KEY
  LLM_PROVIDER=gemini|anthropic (default gemini)
`);
      process.exit(0);
    }
  }

  if (!Number.isFinite(pauseMs) || pauseMs < 0) pauseMs = 4000;
  if (!Number.isFinite(maxSteps) || maxSteps < 1) maxSteps = 25;
  if (!Number.isFinite(exitRateMu) || exitRateMu < 0) exitRateMu = 0;

  return {
    recycle,
    pauseMs,
    maxSteps,
    goal,
    telegramPackage,
    skipLaunch,
    exitRateMu,
  };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const baseUrl = env("COMPUTER_GATEWAY_URL");
  if (!baseUrl) {
    console.error("COMPUTER_GATEWAY_URL is required");
    process.exit(1);
  }

  const provider = parseLlmProviderId(env("LLM_PROVIDER"), "gemini");
  if (provider === "gemini" && !env("GEMINI_API_KEY")) {
    console.error("GEMINI_API_KEY is required (or set LLM_PROVIDER=anthropic)");
    process.exit(1);
  }
  if (provider === "anthropic" && !env("ANTHROPIC_API_KEY")) {
    console.error("ANTHROPIC_API_KEY is required");
    process.exit(1);
  }

  const engine = new ComputerEngine({
    baseUrl,
    token: env("COMPUTER_API_TOKEN"),
    agentId: env("COMPUTER_AGENT_ID") ?? "phone-policy-dogfood",
    defaultTtlSec: Number(env("COMPUTER_TTL_SEC") ?? "900") || 900,
  });

  console.log("Leasing phone seat…");
  const lease = await engine.execute({
    type: "lease",
    params: {
      kind: "phone",
      job_id: env("COMPUTER_JOB_ID") ?? `phone-browse-${Date.now()}`,
    },
  });
  if (!lease.success) {
    console.error(`Lease failed: ${lease.error}`);
    process.exit(1);
  }
  if (engine.getKind() !== "phone") {
    console.error(
      `Gateway did not confirm phone seat (kind=${engine.getKind() ?? "unconfirmed"}).`
    );
    await engine.execute({ type: "release", params: {} });
    process.exit(1);
  }

  console.log("");
  console.log(`  session_id  ${engine.getSessionId()}`);
  console.log(`  kind        ${engine.getKind()}`);
  console.log(`  seat_id     ${engine.getSeatId() ?? "(none)"}`);
  console.log(
    `  Watch:      ${engine.getVncUrl() ?? "(no vnc_url — watch the physical device)"}`
  );
  console.log("");
  console.log("Goal:");
  console.log(opts.goal);
  console.log("");

  if (opts.pauseMs > 0) {
    console.log(`Pause ${opts.pauseMs}ms — open Watch / look at the device…`);
    await sleep(opts.pauseMs);
  }

  const decide = createLlmPhoneDecider(
    createLlmClient({ provider, model: env("LLM_MODEL") })
  );

  console.log("Running phone-policy loop (observe)…");
  const result = await runPhonePolicyLoop(engine, {
    goal: {
      text: opts.goal,
      package: opts.skipLaunch ? undefined : opts.telegramPackage,
      actionMix: {
        swipe: 3,
        click: 3,
        long_press: 2,
        launch: 1,
        type: 1,
        key: 1,
      },
    },
    timing: defaultPhoneTiming({
      actionRateLambda: 0.5,
      exitRateMu: opts.exitRateMu,
      minMs: 600,
      maxMs: 8000,
    }),
    decide,
    maxIterations: opts.maxSteps,
    observeMode: "observe",
    launchSettleMs: 1500,
    swipeSettleMs: 500,
    reuseSession: true,
    heartbeatEachIteration: true,
    recycle: false,
    onObservation: async (obs, iteration) => {
      const n = obs.elements?.length ?? 0;
      console.log(
        `  [iter ${iteration}] observe elements=${n} at ${obs.at}`
      );
    },
  });

  console.log("");
  console.log(
    `Stopped: ${result.stoppedReason}${result.error ? ` — ${result.error}` : ""}`
  );
  console.log(`Steps:   ${result.steps.length}`);
  for (const step of result.steps) {
    const act =
      step.decision.kind === "act" && step.decision.action
        ? JSON.stringify(step.decision.action)
        : step.decision.kind;
    console.log(
      `  ${step.iteration}. ${act}${step.decision.reason ? ` (${step.decision.reason})` : ""}${
        step.actionOk === false ? ` FAIL ${step.actionError ?? ""}` : ""
      }`
    );
  }

  if (engine.getSessionId()) {
    if (opts.recycle) {
      console.log("\nRecycling…");
      await engine.execute({ type: "recycle", params: {} });
    } else {
      console.log("\nSoft-parking…");
      await engine.execute({ type: "release", params: {} });
    }
  }

  if (
    result.stoppedReason !== "done" &&
    result.stoppedReason !== "exit_hazard"
  ) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
