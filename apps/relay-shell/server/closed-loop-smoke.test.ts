/**
 * ASAP closed-loop smoke — GitHub triage via Apps lifecycle handlers.
 * Mirrors Desk: stub Spec → install → mark → shadow → approve → Run once →
 * resume HITL → Enable (schedule separate).
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { buildRelayAppBundle } from "@relay/app-bundle";
import { createMemoryRunStateStore } from "@relay/spec-host";
import { loadCuratedService } from "@relay/services";
import {
  handleAppApproveEvidence,
  handleAppEnable,
  handleAppRunOnce,
  handleAppRuns,
  handleAppShadowRun,
  handleConnectApp,
  handleInstallApp,
} from "./apps-lifecycle.js";
import {
  setInstalledAppsDirForTests,
} from "./installed-apps.js";
import {
  handleResumeRun,
  setDeskRunStateStoreForTests,
  stubSpecFromIntent,
} from "./spec-v2.js";

describe("closed-loop smoke (GitHub triage ASAP)", () => {
  let dir: string;

  afterEach(() => {
    setInstalledAppsDirForTests(undefined);
    setDeskRunStateStoreForTests(undefined);
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("stub → install → mark → shadow → approve → run once → HITL resume → enable", async () => {
    dir = mkdtempSync(join(tmpdir(), "relay-closed-loop-"));
    setInstalledAppsDirForTests(dir);
    setDeskRunStateStoreForTests(createMemoryRunStateStore());

    const body = stubSpecFromIntent(
      "Every weekday triage GitHub bugs in acme/widgets; ask before posting"
    );
    assert.deepEqual(body.services, ["github"]);

    const github = loadCuratedService("github");
    const bundle = buildRelayAppBundle({
      body,
      services: [github],
    });
    const installed = await handleInstallApp({
      json: JSON.stringify(bundle),
    });
    assert.equal(installed.ok, true);
    const id = installed.ok ? installed.app!.id : "";

    const marked = await handleConnectApp(id, {
      connection: "github:default",
      connected: true,
    });
    assert.equal(marked.ok, true);

    const shadow = await handleAppShadowRun(id, { autoApprove: true });
    assert.equal(shadow.ok, true);
    assert.equal(shadow.state, "COMPLETE");
    assert.ok(shadow.runId);

    const approve = await handleAppApproveEvidence(id, {
      runId: shadow.runId,
    });
    assert.equal(approve.ok, true);
    assert.equal(approve.ok && approve.app?.needsShadowGate, false);

    const runOnce = await handleAppRunOnce(id);
    assert.equal(runOnce.ok, true);
    assert.ok(runOnce.runId);
    assert.equal(
      runOnce.state,
      "WAITING_USER",
      `expected HITL pause, got ${runOnce.state}`
    );

    const listedWaiting = await handleAppRuns(id);
    assert.equal(listedWaiting.ok, true);
    assert.ok(
      listedWaiting.ok &&
        listedWaiting.runs?.some((r) => r.runId === runOnce.runId),
      "Run once must appear under app runs while waiting"
    );

    let resumed = await handleResumeRun(runOnce.runId!, {
      action: "proceed",
      value: true,
    });
    // Soft-rule / fanout may pause again; approve until terminal.
    let guards = 0;
    while (
      resumed.ok &&
      "state" in resumed &&
      resumed.state === "WAITING_USER" &&
      guards < 5
    ) {
      guards += 1;
      resumed = await handleResumeRun(runOnce.runId!, {
        action: "proceed",
        value: true,
      });
    }
    assert.equal(resumed.ok, true);
    assert.ok(
      resumed.ok &&
        "state" in resumed &&
        (resumed.state === "COMPLETE" || resumed.state === "WAITING_USER"),
      `unexpected resume state ${resumed.ok && "state" in resumed ? resumed.state : "?"}`
    );
    if (resumed.ok && "state" in resumed && resumed.state === "WAITING_USER") {
      // One more proceed if still waiting (approve stage only once for stub).
      resumed = await handleResumeRun(runOnce.runId!, {
        action: "proceed",
        value: true,
      });
    }
    assert.equal(
      resumed.ok && "state" in resumed ? resumed.state : undefined,
      "COMPLETE"
    );

    const enable = await handleAppEnable(id);
    assert.equal(enable.ok, true);
    assert.equal(enable.ok && enable.app?.scheduleState, "enabled");

    const listed = await handleAppRuns(id);
    assert.equal(listed.ok, true);
    assert.ok(
      listed.ok &&
        listed.runs?.some(
          (r) => r.runId === runOnce.runId && r.status === "complete"
        ),
      "completed Run once must remain under app runs"
    );
  });
});
