/**
 * Watchable phone-seat dogfood against computer-with-agent.
 *
 *   COMPUTER_GATEWAY_URL=http://localhost:9000 \
 *   COMPUTER_API_TOKEN=dev-token \
 *   pnpm --filter @relay/engines-computer dogfood:phone
 *
 * Needs a free or soft-parked `kind=phone` seat (ADB device up). Soft-parks by
 * default; pass --recycle to wipe. Physical screen is enough if scrcpy-web is
 * not configured — print Watch URL either way.
 */
import { claimPhoneSeat } from "../src/claim-phone-seat.js";
import { ComputerEngine } from "../src/computer-engine.js";
import type { ComputerActionPayload } from "../src/types.js";

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v || undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(argv: string[]) {
  let recycle = false;
  let pauseMs = Number(env("PHONE_DOGFOOD_PAUSE_MS") ?? "2500");
  let settleMs = Number(env("PHONE_DOGFOOD_SETTLE_MS") ?? "800");
  let settingsPackage =
    env("PHONE_DOGFOOD_SETTINGS_PACKAGE") ?? "com.android.settings";
  let sessionId = env("COMPUTER_SESSION_ID");
  let seatId = env("COMPUTER_SEAT_ID");

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") continue;
    if (a === "--recycle") recycle = true;
    else if (a === "--pause-ms" && argv[i + 1]) {
      pauseMs = Number(argv[++i]);
    } else if (a === "--settle-ms" && argv[i + 1]) {
      settleMs = Number(argv[++i]);
    } else if (a === "--settings-package" && argv[i + 1]) {
      settingsPackage = argv[++i]!;
    } else if (a === "--session-id" && argv[i + 1]) {
      sessionId = argv[++i]!;
    } else if (a === "--seat-id" && argv[i + 1]) {
      seatId = argv[++i]!;
    } else if (a === "--help" || a === "-h") {
      console.log(`Usage: phone-dogfood [options]

Options:
  --recycle              Recycle (wipe) instead of soft-park
  --pause-ms <n>         Wait after lease so you can open Watch (default 2500)
  --settle-ms <n>        Settle after launch/swipe (default 800)
  --settings-package <p> Android package to launch (default com.android.settings)
  --session-id <id>      Acquire this parked session (skip free lease)
  --seat-id <id>         Prefer this seat when resuming a parked phone

Env:
  COMPUTER_GATEWAY_URL   required (e.g. http://localhost:9000)
  COMPUTER_API_TOKEN     optional bearer
  COMPUTER_SESSION_ID / COMPUTER_SEAT_ID
  PHONE_DOGFOOD_*        same as flags above
`);
      process.exit(0);
    }
  }

  if (!Number.isFinite(pauseMs) || pauseMs < 0) pauseMs = 2500;
  if (!Number.isFinite(settleMs) || settleMs < 0) settleMs = 800;

  return { recycle, pauseMs, settleMs, settingsPackage, sessionId, seatId };
}

async function mustAct(
  engine: ComputerEngine,
  action: ComputerActionPayload,
  label: string
): Promise<void> {
  const result = await engine.execute({ type: "action", params: { action } });
  if (!result.success) {
    throw new Error(`${label} failed: ${result.error ?? "unknown"}`);
  }
  console.log(`  ok  ${label}`);
}

function findAboutRef(
  elements: Array<Record<string, unknown>> | undefined
): string | undefined {
  if (!Array.isArray(elements)) return undefined;
  for (const el of elements) {
    const ref = typeof el.ref === "string" ? el.ref : undefined;
    if (!ref) continue;
    const hay = `${el.text ?? ""} ${el.content_desc ?? ""}`.toLowerCase();
    if (hay.includes("about phone") || hay.includes("about device")) {
      return ref;
    }
  }
  for (const el of elements) {
    const ref = typeof el.ref === "string" ? el.ref : undefined;
    if (!ref) continue;
    const hay = `${el.text ?? ""} ${el.content_desc ?? ""}`.toLowerCase();
    if (/\babout\b/.test(hay) && el.clickable === true) {
      return ref;
    }
  }
  return undefined;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const baseUrl = env("COMPUTER_GATEWAY_URL");
  if (!baseUrl) {
    console.error("COMPUTER_GATEWAY_URL is required (e.g. http://localhost:9000)");
    process.exit(1);
  }

  const engine = new ComputerEngine({
    baseUrl,
    token: env("COMPUTER_API_TOKEN"),
    agentId: env("COMPUTER_AGENT_ID") ?? "phone-dogfood",
    defaultTtlSec: Number(env("COMPUTER_TTL_SEC") ?? "600") || 600,
  });

  console.log("Claiming phone seat (free lease, else parked acquire)…");
  const lease = await claimPhoneSeat(engine, {
    jobId: env("COMPUTER_JOB_ID") ?? `phone-dogfood-${Date.now()}`,
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

  const vnc = engine.getVncUrl();
  const kind = engine.getKind();
  const seatId = engine.getSeatId();
  const sessionId = engine.getSessionId();

  console.log("");
  console.log(`  session_id  ${sessionId}`);
  console.log(`  kind        ${kind ?? "(unconfirmed)"}`);
  console.log(`  seat_id     ${seatId ?? "(none)"}`);
  console.log(`  Watch:      ${vnc ?? "(no vnc_url — watch the physical device)"}`);
  console.log("");

  // Gateway must echo kind=phone (and usually seat_id). Older stacks ignore
  // `kind` and hand back a desktop noVNC worker — launch/observe then 400/404.
  if (kind !== "phone") {
    console.error(
      "Gateway did not confirm a phone seat (kind missing or not phone)."
    );
    console.error(
      "Update computer-with-agent, ensure inventory has a free kind=phone worker,"
    );
    console.error("then check: curl -s -H \"Authorization: Bearer $COMPUTER_API_TOKEN\" \"$COMPUTER_GATEWAY_URL/v1/seats\" | jq .");
    try {
      await engine.execute({ type: "release", params: {} });
    } catch {
      /* best-effort */
    }
    process.exit(1);
  }

  if (opts.pauseMs > 0) {
    console.log(
      `Pause ${opts.pauseMs}ms — open Watch / look at the device…`
    );
    await sleep(opts.pauseMs);
  }

  try {
    console.log("1. launch Settings");
    await mustAct(
      engine,
      { type: "launch", package: opts.settingsPackage },
      `launch ${opts.settingsPackage}`
    );
    await sleep(opts.settleMs);

    console.log("2. observe");
    let obs = await engine.execute({
      type: "observe",
      params: { max_elements: 120 },
    });
    if (!obs.success) {
      throw new Error(`observe failed: ${obs.error}`);
    }
    const count = obs.data?.element_count ?? obs.data?.elements?.length ?? 0;
    console.log(`  ok  observe · elements=${count}`);

    let aboutRef = findAboutRef(
      obs.data?.elements as Array<Record<string, unknown>> | undefined
    );

    if (!aboutRef) {
      console.log("3. swipe (seek About)");
      await mustAct(
        engine,
        {
          type: "swipe",
          x1: 540,
          y1: 1800,
          x2: 540,
          y2: 600,
          duration_ms: 350,
        },
        "swipe up"
      );
      await sleep(opts.settleMs);

      obs = await engine.execute({
        type: "observe",
        params: { max_elements: 120 },
      });
      if (!obs.success) {
        throw new Error(`observe failed: ${obs.error}`);
      }
      aboutRef = findAboutRef(
        obs.data?.elements as Array<Record<string, unknown>> | undefined
      );
      console.log(
        `  ok  observe · elements=${obs.data?.element_count ?? "?"} · aboutRef=${aboutRef ?? "none"}`
      );
    } else {
      console.log(`3. skip swipe (About ref=${aboutRef})`);
    }

    if (aboutRef) {
      console.log(`4. tap About (ref=${aboutRef})`);
      await mustAct(
        engine,
        { type: "tap", ref: aboutRef },
        `tap ref=${aboutRef}`
      );
      await sleep(opts.settleMs);
    } else {
      console.log("4. skip tap (no About row in tree — Settings still open)");
    }

    console.log("5. key home");
    await mustAct(engine, { type: "key", text: "home" }, "key home");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\nDogfood step failed: ${message}`);
    console.error(
      `Seat still leased — Watch: ${engine.getVncUrl() ?? "(physical device)"}`
    );
    try {
      if (opts.recycle) {
        await engine.execute({ type: "recycle", params: {} });
        console.error("Recycled after failure.");
      } else {
        await engine.execute({ type: "release", params: {} });
        console.error("Soft-parked after failure.");
      }
    } catch (parkErr) {
      console.error(
        `Cleanup also failed: ${
          parkErr instanceof Error ? parkErr.message : String(parkErr)
        }`
      );
    }
    process.exit(1);
  }

  if (opts.recycle) {
    console.log("\nRecycling seat…");
    const recycled = await engine.execute({ type: "recycle", params: {} });
    if (!recycled.success) {
      console.error(`Recycle failed: ${recycled.error}`);
      process.exit(1);
    }
    console.log("Done (recycled).");
  } else {
    console.log("\nSoft-parking seat…");
    const parked = await engine.execute({ type: "release", params: {} });
    if (!parked.success) {
      console.error(`Park failed: ${parked.error}`);
      process.exit(1);
    }
    console.log(
      `Done (parked). Re-acquire session ${sessionId} or Watch: ${vnc ?? "physical device"}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
