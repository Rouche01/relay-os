import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { buildRelayAppBundle } from "@relay/app-bundle";
import type { SpecV2Body } from "@relay/protocol";
import { createMemoryRunStateStore } from "@relay/spec-host";
import {
  handleAppApproveEvidence,
  handleAppEnable,
  handleAppPause,
  handleAppRunOnce,
  handleAppRuns,
  handleAppShadowRun,
  handleAppThaw,
  handleConnectApp,
  handleInstallApp,
} from "./apps-lifecycle.js";
import {
  allConnectionsConnected,
  createInstalledAppFromBundle,
  getInstalledApp,
  listInstalledApps,
  saveInstalledApp,
  setInstalledAppsDirForTests,
  toInstalledAppSummary,
} from "./installed-apps.js";
import { setDeskRunStateStoreForTests } from "./spec-v2.js";

const body: SpecV2Body = {
  goal: "Observe then approve",
  connections: [],
  services: [],
  trigger: { schedule: { cron: "0 9 * * 1-5" } },
  budget: { dryRun: true },
  rules: [],
  steps: [
    {
      id: "look",
      use: "computer.observe",
      args: {},
    },
    {
      id: "approve",
      use: "human.approve",
      args: { show: "${steps.look.output}" },
    },
  ],
};

describe("installed-apps store", () => {
  let dir: string;

  afterEach(() => {
    setInstalledAppsDirForTests(undefined);
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("persists install defaults and connection marks", () => {
    dir = mkdtempSync(join(tmpdir(), "relay-apps-"));
    setInstalledAppsDirForTests(dir);

    const bundle = buildRelayAppBundle({
      body: {
        ...body,
        connections: ["github:default"],
        services: ["github"],
        steps: [
          {
            id: "scout",
            use: "api.request",
            args: {
              service: "github",
              operation: "issuesListForRepo",
              connection: "github:default",
              params: { owner: "acme", repo: "widgets" },
            },
          },
          {
            id: "approve",
            use: "human.approve",
            args: { show: "${steps.scout.output}" },
          },
        ],
      },
      services: [
        {
          id: "github",
          baseUrl: "https://api.github.com",
          auth: { type: "bearer", connection: true },
          operations: [
            {
              id: "issuesListForRepo",
              method: "GET",
              path: "/repos/{owner}/{repo}/issues",
              params: [
                { name: "owner", in: "path", required: true, type: "string" },
                { name: "repo", in: "path", required: true, type: "string" },
              ],
            },
          ],
        },
      ],
    });

    const app = createInstalledAppFromBundle(bundle);
    assert.equal(app.scheduleState, "disabled");
    assert.equal(app.needsShadowGate, true);
    assert.equal(app.editing, false);
    assert.equal(allConnectionsConnected(app), false);
    saveInstalledApp(app);

    const loaded = getInstalledApp(bundle.id);
    assert.ok(loaded);
    assert.equal(listInstalledApps().length, 1);
    const summary = toInstalledAppSummary(loaded!);
    assert.equal(summary.connectionsRequired, 1);
    assert.equal(summary.connectionsConnected, 0);
  });
});

describe("apps lifecycle", () => {
  let dir: string;

  afterEach(() => {
    setInstalledAppsDirForTests(undefined);
    setDeskRunStateStoreForTests(undefined);
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("install → shadow → approve → enable → pause; thaw re-gates", async () => {
    dir = mkdtempSync(join(tmpdir(), "relay-apps-life-"));
    setInstalledAppsDirForTests(dir);
    setDeskRunStateStoreForTests(createMemoryRunStateStore());

    const bundle = buildRelayAppBundle({
      body,
      services: [],
    });
    const installed = await handleInstallApp({
      json: JSON.stringify(bundle),
    });
    assert.equal(installed.ok, true);
    assert.ok(installed.ok && installed.app);
    const id = installed.app!.id;

    // No connections required — shadow immediately.
    const shadow = await handleAppShadowRun(id, { autoApprove: true });
    assert.equal(shadow.ok, true);
    assert.equal(shadow.state, "COMPLETE");
    assert.ok(shadow.runId);

    const approve = await handleAppApproveEvidence(id, {
      runId: shadow.runId,
    });
    assert.equal(approve.ok, true);
    assert.equal(approve.ok && approve.app?.needsShadowGate, false);

    const enable = await handleAppEnable(id);
    assert.equal(enable.ok, true);
    assert.equal(enable.ok && enable.app?.scheduleState, "enabled");

    const pause = await handleAppPause(id);
    assert.equal(pause.ok, true);
    assert.equal(pause.ok && pause.app?.scheduleState, "paused");

    const thaw = await handleAppThaw(id);
    assert.equal(thaw.ok, true);
    assert.equal(thaw.ok && thaw.app?.editing, true);
    assert.equal(thaw.ok && thaw.app?.needsShadowGate, true);
    assert.equal(thaw.ok && thaw.app?.scheduleState, "disabled");

    const enableAgain = await handleAppEnable(id);
    assert.equal(enableAgain.ok, false);
    assert.equal(
      "code" in enableAgain ? enableAgain.code : undefined,
      "app_editing"
    );
  });

  it("blocks shadow until required connections are marked", async () => {
    dir = mkdtempSync(join(tmpdir(), "relay-apps-conn-"));
    setInstalledAppsDirForTests(dir);
    setDeskRunStateStoreForTests(createMemoryRunStateStore());

    const githubBundle = buildRelayAppBundle({
      body: {
        goal: "List issues",
        connections: ["github:default"],
        services: ["github"],
        budget: { dryRun: true },
        rules: [],
        steps: [
          {
            id: "scout",
            use: "api.request",
            args: {
              service: "github",
              operation: "issuesListForRepo",
              connection: "github:default",
              params: { owner: "acme", repo: "widgets" },
            },
          },
        ],
      },
      services: [
        {
          id: "github",
          baseUrl: "https://api.github.com",
          auth: { type: "bearer", connection: true },
          operations: [
            {
              id: "issuesListForRepo",
              method: "GET",
              path: "/repos/{owner}/{repo}/issues",
              params: [
                { name: "owner", in: "path", required: true, type: "string" },
                { name: "repo", in: "path", required: true, type: "string" },
              ],
            },
          ],
        },
      ],
    });

    const installed = await handleInstallApp({
      json: JSON.stringify(githubBundle),
    });
    assert.equal(installed.ok, true);
    const id = installed.ok ? installed.app!.id : "";

    const blocked = await handleAppShadowRun(id);
    assert.equal(blocked.ok, false);
    assert.equal(
      "code" in blocked ? blocked.code : undefined,
      "connections_incomplete"
    );

    const connected = await handleConnectApp(id, {
      connection: "github:default",
    });
    assert.equal(connected.ok, true);

    const shadow = await handleAppShadowRun(id, { autoApprove: true });
    assert.equal(shadow.ok, true);
    assert.equal(shadow.state, "COMPLETE");
  });

  it("Run once blocked before shadow gate; works after approve; thaw blocks", async () => {
    dir = mkdtempSync(join(tmpdir(), "relay-apps-run-once-"));
    setInstalledAppsDirForTests(dir);
    setDeskRunStateStoreForTests(createMemoryRunStateStore());

    const bundle = buildRelayAppBundle({
      body,
      services: [],
    });
    const installed = await handleInstallApp({
      json: JSON.stringify(bundle),
    });
    assert.equal(installed.ok, true);
    const id = installed.ok ? installed.app!.id : "";

    const blocked = await handleAppRunOnce(id);
    assert.equal(blocked.ok, false);
    assert.equal(
      "code" in blocked ? blocked.code : undefined,
      "shadow_gate_unapproved"
    );

    const shadow = await handleAppShadowRun(id, { autoApprove: true });
    assert.equal(shadow.ok, true);
    const approve = await handleAppApproveEvidence(id, {
      runId: shadow.runId,
    });
    assert.equal(approve.ok, true);

    const runOnce = await handleAppRunOnce(id);
    assert.equal(runOnce.ok, true);
    assert.ok(runOnce.runId);
    assert.ok(
      runOnce.state === "WAITING_USER" || runOnce.state === "COMPLETE",
      `unexpected state ${runOnce.state}`
    );
    const listed = await handleAppRuns(id);
    assert.equal(listed.ok, true);
    assert.ok(
      listed.ok &&
        listed.runs?.some((r) => r.runId === runOnce.runId),
      "Run once must appear under app runs (same specHash)"
    );

    const thaw = await handleAppThaw(id);
    assert.equal(thaw.ok, true);
    const blockedThaw = await handleAppRunOnce(id);
    assert.equal(blockedThaw.ok, false);
    assert.equal(
      "code" in blockedThaw ? blockedThaw.code : undefined,
      "app_editing"
    );
  });
});
