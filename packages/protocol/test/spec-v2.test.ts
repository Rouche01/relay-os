import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  SPEC_V2_JSON_SCHEMA,
  SPEC_V2_SCHEMA_ID,
  checkSpecV2BodyShape,
  checkSpecV2TriggerShape,
  checkSpecV2WhenShape,
  classifySpecV2Trigger,
  collectSpecV2Refs,
  createDraftSpecV2,
  freezeSpecV2,
  isSpecV2Ref,
  markSpecV2Running,
  parseSpecV2Ref,
  thawSpecV2,
  toSpecV2Body,
  type SpecV2Body,
} from "../src/index.js";

/** Example from the generated-HITL plan (CE-lite shape). */
const engageLiteBody: SpecV2Body = {
  goal: "Help people in allowlisted fashion subreddits with genuinely useful replies",
  connections: ["reddit:default"],
  services: ["reddit-public"],
  budget: { maxJobs: 3, dryRun: true },
  rules: [
    {
      id: "allowlist_only",
      kind: "hard",
      check: {
        in: "${item.subreddit}",
        list: ["malefashionadvice", "femalefashionadvice"],
      },
    },
    {
      id: "no_promo_links",
      kind: "hard",
      check: { notMatches: "${draft.text}", pattern: "https?://" },
    },
    {
      id: "helpful_reply",
      kind: "soft",
      judge: {
        rubric: ["threadFit", "soundsHuman", "specificity"],
        minMean: 3.5,
      },
    },
    {
      id: "earns_engagement",
      kind: "outcome",
      metric: { name: "comment_score", after: "48h", min: 2 },
    },
  ],
  steps: [
    {
      id: "scout",
      use: "api.request",
      args: {
        service: "reddit-public",
        operation: "listNew",
        params: { sub: "${rules.allowlist_only.list}" },
      },
      outputs: ["posts"],
    },
    {
      id: "score",
      use: "llm.classify",
      forEach: "${steps.scout.output.posts}",
      args: { labels: ["answerable", "skip"] },
    },
    {
      id: "draft",
      use: "llm.generate",
      forEach: "${steps.score.output.answerable}",
      enforce: ["no_promo_links", "helpful_reply"],
    },
    {
      id: "approve",
      use: "human.approve",
      args: { show: "${steps.draft.output}" },
    },
    {
      id: "post",
      use: "api.request",
      args: {
        service: "reddit-oauth",
        operation: "comment",
        connection: "reddit:default",
        method: "POST",
      },
    },
    {
      id: "learn",
      use: "data.append",
      args: { store: "outcomes", value: "${steps.post.output}" },
    },
  ],
};

describe("Spec v2", () => {
  it("creates a draft with default dryRun budget and freeze/thaw lifecycle", () => {
    const draft = createDraftSpecV2({
      goal: "Demo",
      steps: [{ id: "a", use: "human.approve", args: { show: "x" } }],
    });
    assert.equal(draft.status, "draft");
    assert.equal(draft.budget?.dryRun, true);
    assert.equal(draft.steps.length, 1);

    const frozen = freezeSpecV2(draft, { frozenBy: "test" });
    assert.equal(frozen.status, "frozen");
    assert.equal(frozen.frozenBy, "test");
    assert.ok(frozen.frozenAt);

    const thawed = thawSpecV2(frozen);
    assert.equal(thawed.status, "draft");
    assert.equal(thawed.version, frozen.version + 1);
    assert.equal(thawed.frozenAt, undefined);

    const running = markSpecV2Running(freezeSpecV2(thawed));
    assert.equal(running.status, "running");
  });

  it("rejects empty goal, empty steps, and duplicate ids", () => {
    assert.throws(() =>
      createDraftSpecV2({ goal: "  ", steps: [{ id: "a", use: "llm.generate" }] })
    );
    assert.throws(() => createDraftSpecV2({ goal: "x", steps: [] }));
    assert.throws(() =>
      createDraftSpecV2({
        goal: "x",
        steps: [
          { id: "a", use: "llm.generate" },
          { id: "a", use: "llm.classify" },
        ],
      })
    );
    assert.throws(() =>
      createDraftSpecV2({
        goal: "x",
        rules: [
          { id: "r", kind: "hard", check: { eq: 1, value: 1 } },
          { id: "r", kind: "soft", judge: { rubric: ["a"] } },
        ],
        steps: [{ id: "a", use: "llm.generate" }],
      })
    );
  });

  it("parses and collects ${...} refs", () => {
    assert.equal(isSpecV2Ref("${steps.scout.output.posts}"), true);
    assert.equal(isSpecV2Ref("steps.scout.output.posts"), false);
    assert.equal(
      parseSpecV2Ref("${steps.scout.output.posts}"),
      "steps.scout.output.posts"
    );

    const refs = collectSpecV2Refs(engageLiteBody);
    assert.ok(refs.includes("item.subreddit"));
    assert.ok(refs.includes("draft.text"));
    assert.ok(refs.includes("steps.scout.output.posts"));
    assert.ok(refs.includes("rules.allowlist_only.list"));
  });

  it("shape-checks the plan example body", () => {
    const checked = checkSpecV2BodyShape(engageLiteBody);
    assert.equal(checked.ok, true);

    const bad = checkSpecV2BodyShape({ goal: "x", steps: [{ id: "a" }] });
    assert.equal(bad.ok, false);
    if (!bad.ok) {
      assert.ok(bad.errors.some((e) => e.includes("use")));
    }
  });

  it("exports JSON Schema with required goal and steps", () => {
    assert.equal(SPEC_V2_SCHEMA_ID, SPEC_V2_JSON_SCHEMA.$id);
    assert.deepEqual(SPEC_V2_JSON_SCHEMA.required, ["goal", "steps"]);
    assert.ok(SPEC_V2_JSON_SCHEMA.$defs?.step);
    assert.ok(SPEC_V2_JSON_SCHEMA.$defs?.rule);
    assert.ok(SPEC_V2_JSON_SCHEMA.$defs?.hardCheck);

    const body = toSpecV2Body(createDraftSpecV2(engageLiteBody));
    assert.equal(body.goal, engageLiteBody.goal);
    assert.equal(body.steps.length, engageLiteBody.steps.length);
    assert.deepEqual(body.connections, ["reddit:default"]);
  });

  it("shape-checks Spec v2.1 when gates", () => {
    assert.deepEqual(checkSpecV2WhenShape("${item.ok}"), []);
    assert.deepEqual(checkSpecV2WhenShape({ eq: 1, value: 1 }), []);
    assert.deepEqual(checkSpecV2WhenShape({ ne: "a", value: "b" }), []);
    assert.deepEqual(checkSpecV2WhenShape({ in: "x", list: ["x"] }), []);
    assert.deepEqual(checkSpecV2WhenShape({ exists: "${item.id}" }), []);
    assert.ok(checkSpecV2WhenShape("not-a-ref").length);
    assert.ok(checkSpecV2WhenShape({ eq: 1, ne: 2 }).length);
  });

  it("classifies Spec v2.1 trigger shapes", () => {
    assert.deepEqual(classifySpecV2Trigger({ manual: true }), {
      kind: "manual",
    });
    assert.deepEqual(
      classifySpecV2Trigger({ schedule: { cron: "0 9 * * 1-5" } }),
      { kind: "schedule", cron: "0 9 * * 1-5", timezone: undefined }
    );
    assert.deepEqual(
      classifySpecV2Trigger({
        poll: { everyMs: 60_000, sourceStep: "scout" },
      }),
      { kind: "poll", everyMs: 60_000, sourceStep: "scout" }
    );
    assert.ok(
      checkSpecV2TriggerShape({
        manual: true,
        schedule: { cron: "0 * * * *" },
      }).length
    );
    assert.ok(checkSpecV2TriggerShape({}).length);
    const badPoll = checkSpecV2BodyShape({
      ...engageLiteBody,
      trigger: { poll: { everyMs: 0, sourceStep: "scout" } },
    });
    assert.equal(badPoll.ok, false);
  });

  it("keeps spec-v2.schema.json in sync with SPEC_V2_JSON_SCHEMA", () => {
    // dist-test/test → ../../src ; also allow running from src-adjacent
    const candidates = [
      join(__dirname, "../../src/spec-v2.schema.json"),
      join(__dirname, "../src/spec-v2.schema.json"),
    ];
    let onDisk: unknown;
    for (const p of candidates) {
      try {
        onDisk = JSON.parse(readFileSync(p, "utf8"));
        break;
      } catch {
        /* try next */
      }
    }
    assert.ok(onDisk, "spec-v2.schema.json not found");
    assert.deepEqual(onDisk, SPEC_V2_JSON_SCHEMA);
  });
});
