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
import {
  claimPhoneSeat,
  ComputerEngine,
} from "@relay/engines-computer";
import { createLlmClient, parseLlmProviderId } from "@relay/llm";
import {
  createLlmPhoneDecider,
  defaultPhoneTiming,
  runPhonePolicyLoop,
} from "../src/index.js";

const DEFAULT_GOAL = `Open Telegram, then open ONLY the chat/channel whose title is exactly "Amsterdam" (case-insensitive). Do NOT open any other chat (e.g. "Stylens Ops" or whichever chat is pinned/top of the list).

How to find it:
1. From the chats list, tap Search (magnifying glass) and type Amsterdam, OR swipe the chat list until you see a row whose title text is Amsterdam.
2. Tap that Amsterdam row only. After opening, verify the top app bar / header title shows Amsterdam. If it shows any other name, press key back and keep searching — never react in the wrong thread.
3. Only inside the Amsterdam thread — add a ❤️ reaction like this (do NOT long_press):
   a. Single tap (click) the most recent message once. That opens the reaction dialog / context menu.
   b. Then tap the ❤️ (love/heart) option in that dialog or menu.
   c. If the menu did not open, tap the last message once more (still no long_press). Only if a single tap clearly fails twice may you try long_press as a last resort.
4. kind "done" only when the header still shows Amsterdam AND the ❤️ is clearly visible on the latest message.
5. kind "need_human" if login/2FA, or Amsterdam cannot be found after searching/scrolling.

Prefer launch for Telegram, type into search, swipe the list, then click/tap message → click/tap ❤️. Use key back/home only to leave a wrong chat, dismiss a wrong menu, or leave search.`;

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
  let sessionId = env("COMPUTER_SESSION_ID");
  let seatId = env("COMPUTER_SEAT_ID");

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
    } else if (a === "--session-id" && argv[i + 1]) {
      sessionId = argv[++i]!;
    } else if (a === "--seat-id" && argv[i + 1]) {
      seatId = argv[++i]!;
    } else if (a === "--help" || a === "-h") {
      console.log(`Usage: phone-browse-dogfood [options]

Options:
  --goal <text>              Override the phone goal
  --max-steps <n>            Max policy iterations (default 25)
  --pause-ms <n>             Pause after lease for Watch (default 4000)
  --telegram-package <pkg>   Package to launch first (default ${DEFAULT_TELEGRAM_PACKAGE})
  --skip-launch              Do not pre-launch Telegram (model must launch)
  --session-id <id>          Acquire this parked session (skip free lease)
  --seat-id <id>             Prefer this seat when resuming a parked phone
  --recycle                  Recycle seat instead of soft-park

Env:
  COMPUTER_GATEWAY_URL, COMPUTER_API_TOKEN
  COMPUTER_SESSION_ID / COMPUTER_SEAT_ID
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
    sessionId,
    seatId,
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

  console.log("Claiming phone seat (free lease, else parked acquire)…");
  const lease = await claimPhoneSeat(engine, {
    jobId: env("COMPUTER_JOB_ID") ?? `phone-browse-${Date.now()}`,
    sessionId: opts.sessionId,
    seatId: opts.seatId,
  });
  if (!lease.success) {
    console.error(`Claim failed: ${lease.error}`);
    process.exit(1);
  }
  if (lease.data?.via === "acquire") {
    console.log("Resumed parked phone session.");
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
        click: 4,
        swipe: 3,
        type: 3,
        key: 2,
        launch: 1,
        long_press: 0,
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
