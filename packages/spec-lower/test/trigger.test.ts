import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertSchedulesValid,
  DEFAULT_ENTRYPOINT,
  SPEC_V2_SCHEDULE_ID,
  type SpecV2Body,
} from "@relay/protocol";
import { lowerSpecV2, schedulesFromTrigger } from "../src/index.js";

function baseBody(): SpecV2Body {
  return {
    goal: "Triage bugs on a schedule",
    connections: ["github:default"],
    services: ["github"],
    budget: { maxJobs: 2, dryRun: true },
    rules: [],
    steps: [
      {
        id: "scout",
        use: "api.request",
        args: {
          service: "github",
          operation: "issuesListForRepo",
          params: { owner: "acme", repo: "widgets" },
        },
      },
      {
        id: "approve",
        use: "human.approve",
        args: { show: "${steps.scout.output}" },
      },
    ],
  };
}

describe("schedulesFromTrigger / lowerSpecV2 trigger", () => {
  it("schedule cron → manifest schedules pointing at default", () => {
    const body: SpecV2Body = {
      ...baseBody(),
      trigger: { schedule: { cron: "0 9 * * 1-5" } },
    };
    const schedules = schedulesFromTrigger(body);
    assert.ok(schedules);
    assert.equal(schedules![0]?.id, SPEC_V2_SCHEDULE_ID);
    assert.equal(schedules![0]?.entrypoint, DEFAULT_ENTRYPOINT);
    assert.equal(schedules![0]?.cron, "0 9 * * 1-5");

    const lowered = lowerSpecV2(body, { name: "triage" });
    assert.ok(lowered.manifest.schedules?.length);
    assert.equal(lowered.relay.trigger?.schedule?.cron, "0 9 * * 1-5");
    assertSchedulesValid(lowered.manifest);
  });

  it("poll → every_ms schedule", () => {
    const body: SpecV2Body = {
      ...baseBody(),
      trigger: { poll: { everyMs: 60_000, sourceStep: "scout" } },
    };
    const schedules = schedulesFromTrigger(body)!;
    assert.equal(schedules[0]?.every_ms, 60_000);
    assert.ok(!schedules[0]?.cron);
  });

  it("manual / absent → no schedules", () => {
    assert.equal(schedulesFromTrigger(baseBody()), undefined);
    assert.equal(
      schedulesFromTrigger({ ...baseBody(), trigger: { manual: true } }),
      undefined
    );
    const lowered = lowerSpecV2({ ...baseBody(), trigger: { manual: true } });
    assert.equal(lowered.manifest.schedules, undefined);
  });
});
