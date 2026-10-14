import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CommunityEngagerManifest } from "../src/manifest.js";
import { formatOpsHelp, parseOpsIntent } from "../src/ops/parse.js";

describe("parseOpsIntent", () => {
  const m = CommunityEngagerManifest;

  it("parses one-off vocabulary", () => {
    assert.deepEqual(parseOpsIntent("engage", m), {
      kind: "one_off",
      entrypoint: "engage",
    });
    assert.deepEqual(parseOpsIntent("  Engage Community  ", m), {
      kind: "one_off",
      entrypoint: "engage",
    });
    assert.deepEqual(parseOpsIntent("scout reddit", m), {
      kind: "one_off",
      entrypoint: "engage",
    });
    assert.deepEqual(parseOpsIntent("watch posts", m), {
      kind: "one_off",
      entrypoint: "post_watch",
    });
    assert.deepEqual(parseOpsIntent("post watch", m), {
      kind: "one_off",
      entrypoint: "post_watch",
    });
    assert.deepEqual(parseOpsIntent("post_watch", m), {
      kind: "one_off",
      entrypoint: "post_watch",
    });
  });

  it("parses schedule start/stop/trigger before short aliases", () => {
    assert.deepEqual(parseOpsIntent("start cadence", m), {
      kind: "start_schedule",
      scheduleId: "cadence",
    });
    assert.deepEqual(parseOpsIntent("stop cadence", m), {
      kind: "stop_schedule",
      scheduleId: "cadence",
    });
    assert.deepEqual(parseOpsIntent("run cadence now", m), {
      kind: "trigger",
      scheduleId: "cadence",
    });
    assert.deepEqual(parseOpsIntent("trigger cadence", m), {
      kind: "trigger",
      scheduleId: "cadence",
    });
    assert.deepEqual(parseOpsIntent("start post watch", m), {
      kind: "start_schedule",
      scheduleId: "post_watch",
    });
    assert.deepEqual(parseOpsIntent("start post_watch", m), {
      kind: "start_schedule",
      scheduleId: "post_watch",
    });
    assert.deepEqual(parseOpsIntent("stop post watch", m), {
      kind: "stop_schedule",
      scheduleId: "post_watch",
    });
    assert.deepEqual(parseOpsIntent("run post watch now", m), {
      kind: "trigger",
      scheduleId: "post_watch",
    });
    assert.deepEqual(parseOpsIntent("trigger post_watch", m), {
      kind: "trigger",
      scheduleId: "post_watch",
    });
  });

  it("parses start/stop all and status", () => {
    assert.deepEqual(parseOpsIntent("start schedules", m), {
      kind: "start_all",
    });
    assert.deepEqual(parseOpsIntent("start all", m), { kind: "start_all" });
    assert.deepEqual(parseOpsIntent("stop schedules", m), {
      kind: "stop_all",
    });
    assert.deepEqual(parseOpsIntent("stop all", m), { kind: "stop_all" });
    assert.deepEqual(parseOpsIntent("status", m), { kind: "status" });
    assert.deepEqual(parseOpsIntent("schedules", m), { kind: "status" });
  });

  it("maps manifest trigger patterns and examples", () => {
    assert.deepEqual(parseOpsIntent("engage community", m), {
      kind: "one_off",
      entrypoint: "engage",
    });
    assert.deepEqual(parseOpsIntent("scout reddit for gostylens", m), {
      kind: "one_off",
      entrypoint: "engage",
    });
    assert.deepEqual(parseOpsIntent("find reddit opportunities", m), {
      kind: "one_off",
      entrypoint: "engage",
    });
    assert.deepEqual(parseOpsIntent("watch posts", m), {
      kind: "one_off",
      entrypoint: "post_watch",
    });
    assert.deepEqual(parseOpsIntent("drain post-watch queue", m), {
      kind: "one_off",
      entrypoint: "post_watch",
    });
  });

  it("help / empty / unknown → help", () => {
    assert.deepEqual(parseOpsIntent("help", m), { kind: "help" });
    assert.deepEqual(parseOpsIntent("?", m), { kind: "help" });
    assert.deepEqual(parseOpsIntent("ops", m), { kind: "help" });
    assert.deepEqual(parseOpsIntent("   ", m), {
      kind: "help",
      reason: "empty",
    });

    const cmd = parseOpsIntent("dance monkey", m);
    assert.equal(cmd.kind, "help");
    if (cmd.kind === "help") {
      assert.match(cmd.reason ?? "", /unknown/);
      assert.match(formatOpsHelp(cmd.reason), /Unknown ops intent/);
      assert.match(formatOpsHelp(cmd.reason), /engage community/);
    }
  });

  it("parses Telegram slash forms (@bot + underscores)", () => {
    assert.deepEqual(parseOpsIntent("/status", m), { kind: "status" });
    assert.deepEqual(parseOpsIntent("/status@SomeBot", m), { kind: "status" });
    assert.deepEqual(parseOpsIntent("/help", m), { kind: "help" });
    assert.deepEqual(parseOpsIntent("/engage", m), {
      kind: "one_off",
      entrypoint: "engage",
    });
    assert.deepEqual(parseOpsIntent("/watch_posts", m), {
      kind: "one_off",
      entrypoint: "post_watch",
    });
    assert.deepEqual(parseOpsIntent("/start_cadence", m), {
      kind: "start_schedule",
      scheduleId: "cadence",
    });
    assert.deepEqual(parseOpsIntent("/stop_cadence@RelayBot", m), {
      kind: "stop_schedule",
      scheduleId: "cadence",
    });
    assert.deepEqual(parseOpsIntent("/run_post_watch_now", m), {
      kind: "trigger",
      scheduleId: "post_watch",
    });
    assert.deepEqual(parseOpsIntent("/run_cadence_now", m), {
      kind: "trigger",
      scheduleId: "cadence",
    });
    assert.deepEqual(parseOpsIntent("/start_schedules", m), {
      kind: "start_all",
    });
    assert.deepEqual(parseOpsIntent("/stop_schedules", m), {
      kind: "stop_all",
    });
  });
});
