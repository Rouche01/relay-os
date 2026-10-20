import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_ENTRYPOINT,
  assertSchedulesValid,
  listEnabledSchedules,
  listEntrypointNames,
  listSchedules,
  resolveEntrypoint,
  type AgenticAppManifest,
  type ExecutionEngine,
  type StageDefinition,
} from "@relay/protocol";
import {
  AgentRuntime,
  bindEngines,
  type AppController,
} from "@relay/runtime";
import {
  CommunityEngagerManifest,
  CommunityPostWatchManifest,
  manifestForEntrypoint,
  protocolEntrypointName,
  resolveCommunityEntrypoint,
} from "../src/manifest.js";

function stubEngines(): Record<string, ExecutionEngine> {
  const mk = (type: "browser" | "llm" | "data"): ExecutionEngine => ({
    type,
    async execute() {
      return { success: true, data: {} };
    },
    async healthCheck() {
      return true;
    },
    async teardown() {},
  });
  return { browser: mk("browser"), llm: mk("llm"), data: mk("data") };
}

/** Records which stages `onStageStart` saw (runtime does not call a separate execute). */
function recordingController(ran: string[]): AppController {
  return {
    async onStageStart(stage: StageDefinition) {
      ran.push(stage.name);
    },
  };
}

const tinyManifest: AgenticAppManifest = {
  name: "TinyEntrypointApp",
  version: "0.0.0",
  description: "test",
  author: "test",
  triggers: [],
  capabilities: [],
  engines_required: [],
  permissions: [],
  stages: [
    { name: "alpha", description: "a", engine: "none" },
    { name: "beta", description: "b", engine: "none" },
  ],
  entrypoints: {
    alt: {
      description: "alternate",
      stages: [{ name: "gamma", description: "g", engine: "none" }],
    },
  },
  feedback_patterns: [],
};

describe("manifest entrypoints (A1)", () => {
  it("engage parent no longer includes post_watch in root stages", () => {
    const names = CommunityEngagerManifest.stages.map((s) => s.name);
    assert.deepEqual(names, [
      "ensure_session",
      "discover",
      "scout",
      "jobs",
    ]);
    assert.ok(!names.includes("post_watch"));
  });

  it("declares post_watch on protocol entrypoints map", () => {
    assert.ok(CommunityEngagerManifest.entrypoints?.post_watch);
    const ep = CommunityEngagerManifest.entrypoints!.post_watch;
    assert.deepEqual(
      ep.stages.map((s) => s.name),
      ["post_watch", "jobs"]
    );
    assert.equal(
      ep.stages,
      CommunityPostWatchManifest.stages,
      "entrypoint stages share CommunityPostWatchManifest.stages"
    );
    assert.deepEqual(listEntrypointNames(CommunityEngagerManifest), [
      DEFAULT_ENTRYPOINT,
      "post_watch",
    ]);
  });

  it("resolveEntrypoint default vs post_watch", () => {
    const def = resolveEntrypoint(CommunityEngagerManifest);
    assert.equal(def.name, DEFAULT_ENTRYPOINT);
    assert.deepEqual(
      def.stages.map((s) => s.name),
      ["ensure_session", "discover", "scout", "jobs"]
    );

    const watch = resolveCommunityEntrypoint("post_watch");
    assert.equal(watch.name, "post_watch");
    assert.deepEqual(
      watch.stages.map((s) => s.name),
      ["post_watch", "jobs"]
    );

    assert.equal(protocolEntrypointName("engage"), undefined);
    assert.equal(protocolEntrypointName("post_watch"), "post_watch");
  });

  it("manifestForEntrypoint projects flat stages views", () => {
    assert.equal(manifestForEntrypoint("engage").name, "CommunityEngager");
    assert.deepEqual(
      manifestForEntrypoint("engage").stages.map((s) => s.name),
      ["ensure_session", "discover", "scout", "jobs"]
    );
    assert.deepEqual(
      manifestForEntrypoint("post_watch").stages.map((s) => s.name),
      ["post_watch", "jobs"]
    );
  });

  it("bindEngines walks entrypoint stage trees (jobs fanout engines)", () => {
    const engines = bindEngines(CommunityEngagerManifest, stubEngines());
    assert.ok(engines.browser);
    assert.ok(engines.llm);
    assert.ok(engines.data);
  });

  it("AgentRuntime default runs root stages only", async () => {
    const ran: string[] = [];
    const runtime = new AgentRuntime(
      tinyManifest,
      {},
      { agentId: "t", userId: "u", sessionId: "s" },
      recordingController(ran)
    );
    assert.equal(runtime.getEntrypoint(), DEFAULT_ENTRYPOINT);
    assert.deepEqual(
      runtime.getActiveStages().map((s) => s.name),
      ["alpha", "beta"]
    );
    await runtime.start();
    assert.equal(runtime.getState(), "COMPLETE");
    assert.deepEqual(ran, ["alpha", "beta"]);
  });

  it("AgentRuntime named entrypoint runs only those stages", async () => {
    const ran: string[] = [];
    const runtime = new AgentRuntime(
      tinyManifest,
      {},
      { agentId: "t", userId: "u", sessionId: "s" },
      recordingController(ran),
      undefined,
      { entrypoint: "alt" }
    );
    assert.equal(runtime.getEntrypoint(), "alt");
    assert.deepEqual(
      runtime.getActiveStages().map((s) => s.name),
      ["gamma"]
    );
    await runtime.start();
    assert.equal(runtime.getState(), "COMPLETE");
    assert.deepEqual(ran, ["gamma"]);
  });

  it("CommunityEngager AgentRuntime selects post_watch active stages", () => {
    const runtime = new AgentRuntime(
      CommunityEngagerManifest,
      stubEngines(),
      { agentId: "t", userId: "u", sessionId: "s" },
      recordingController([]),
      undefined,
      { entrypoint: "post_watch" }
    );
    assert.equal(runtime.getEntrypoint(), "post_watch");
    assert.deepEqual(
      runtime.getActiveStages().map((s) => s.name),
      ["post_watch", "jobs"]
    );
  });

  it("unknown entrypoint throws", () => {
    assert.throws(
      () => resolveEntrypoint(CommunityEngagerManifest, "nope"),
      /Unknown entrypoint "nope"/
    );
  });

  it("declares cadence + post_watch schedules", () => {
    const schedules = listSchedules(CommunityEngagerManifest);
    assert.equal(schedules.length, 2);
    assert.equal(schedules[0]!.id, "cadence");
    assert.equal(schedules[0]!.entrypoint, "default");
    assert.equal(schedules[0]!.cron, "0 9,13,18 * * *");
    assert.equal(schedules[1]!.id, "post_watch");
    assert.equal(schedules[1]!.entrypoint, "post_watch");
    assert.equal(schedules[1]!.every_ms, 60 * 60 * 1000);
    assert.deepEqual(listEnabledSchedules(CommunityEngagerManifest), schedules);
    assert.doesNotThrow(() => assertSchedulesValid(CommunityEngagerManifest));
  });

  it("assertSchedulesValid rejects bad declarations", () => {
    const badEp: AgenticAppManifest = {
      ...tinyManifest,
      schedules: [
        { id: "x", entrypoint: "missing", every_ms: 1000 },
      ],
    };
    assert.throws(
      () => assertSchedulesValid(badEp),
      /unknown entrypoint "missing"/
    );

    const noClock: AgenticAppManifest = {
      ...tinyManifest,
      schedules: [{ id: "x", entrypoint: DEFAULT_ENTRYPOINT }],
    };
    assert.throws(
      () => assertSchedulesValid(noClock),
      /needs cron and\/or every_ms/
    );

    const dup: AgenticAppManifest = {
      ...tinyManifest,
      schedules: [
        { id: "x", entrypoint: DEFAULT_ENTRYPOINT, every_ms: 1000 },
        { id: "x", entrypoint: "alt", every_ms: 2000 },
      ],
    };
    assert.throws(() => assertSchedulesValid(dup), /duplicate schedule id "x"/);
  });
});
