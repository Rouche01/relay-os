import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  parseServiceDescriptorYaml,
  type SpecV2Body,
} from "@relay/protocol";
import {
  parseSpecV2Yaml,
  validateSpecV2,
} from "../src/index.js";

function loadService(name: string) {
  const candidates = [
    join(__dirname, `../../../protocol/services/${name}`),
    join(__dirname, `../../protocol/services/${name}`),
  ];
  for (const p of candidates) {
    try {
      return parseServiceDescriptorYaml(readFileSync(p, "utf8"));
    } catch {
      /* try next */
    }
  }
  throw new Error(`missing service yaml ${name}`);
}

const services = [
  loadService("reddit-public.yaml"),
  loadService("reddit-oauth.yaml"),
];

/** Valid CE-lite Spec from the plan (human before post). */
function goodEngageLite(): SpecV2Body {
  return {
    goal: "Help people in allowlisted fashion subreddits with genuinely useful replies",
    connections: ["reddit:default"],
    services: ["reddit-public", "reddit-oauth"],
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
          params: { subreddit: "malefashionadvice" },
        },
        outputs: ["posts"],
        enforce: ["allowlist_only"],
      },
      {
        id: "score",
        use: "llm.classify",
        forEach: "${steps.scout.output.posts}",
        args: {
          input: "${item}",
          labels: ["answerable", "skip"],
        },
      },
      {
        id: "draft",
        use: "llm.generate",
        forEach: "${steps.score.output.answerable}",
        args: { prompt: "Draft a helpful reply for ${item}" },
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
          params: {
            thing_id: "${steps.draft.output.thing_id}",
            text: "${steps.draft.output.text}",
          },
        },
      },
      {
        id: "learn",
        use: "data.append",
        args: { store: "outcomes", value: "${steps.post.output}" },
      },
    ],
  };
}

describe("validateSpecV2", () => {
  it("accepts a well-formed CE-lite Spec under 50ms", () => {
    const result = validateSpecV2(goodEngageLite(), {
      services,
      knownConnections: ["reddit:default"],
    });
    assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
    assert.equal(result.errors.length, 0);
    assert.ok(result.durationMs < 50, `took ${result.durationMs}ms`);
  });

  it("rejects unknown capabilities and invented API operations", () => {
    const body = goodEngageLite();
    body.steps[0]!.use = "llm.invent";
    body.steps[4]!.args = {
      ...body.steps[4]!.args,
      operation: "deleteUniverse",
    };
    const result = validateSpecV2(body, { services });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.code === "unknown_capability"));
    assert.ok(result.errors.some((e) => e.code === "unknown_operation"));
    assert.ok(
      result.errors.some((e) => e.invariant === "inv_no_unbound_capability")
    );
    assert.ok(
      result.errors.some((e) => e.invariant === "inv_service_operation_bound")
    );
  });

  it("rejects irreversible post without preceding human step", () => {
    const body = goodEngageLite();
    body.steps = body.steps.filter((s) => s.id !== "approve");
    const result = validateSpecV2(body, { services });
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some(
        (e) =>
          e.code === "hitl_before_irreversible" &&
          e.invariant === "inv_hitl_before_irreversible"
      )
    );
  });

  it("rejects forward refs and unenforced hard rules", () => {
    const body = goodEngageLite();
    body.steps[0]!.args = {
      ...body.steps[0]!.args,
      params: { subreddit: "${steps.draft.output.sub}" },
    };
    body.rules = [
      ...(body.rules ?? []),
      {
        id: "orphan_hard",
        kind: "hard",
        check: { eq: 1, value: 1 },
      },
    ];
    const result = validateSpecV2(body, { services });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.code === "forward_step_ref"));
    assert.ok(result.errors.some((e) => e.code === "rule_not_enforced"));
  });

  it("requires maxJobs when forEach is present", () => {
    const body = goodEngageLite();
    body.budget = { dryRun: true };
    const result = validateSpecV2(body, { services });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.code === "budget_max_jobs_required"));
  });

  it("accepts when gates and rejects invalid when shapes", () => {
    const body = goodEngageLite();
    body.steps = body.steps.map((s) =>
      s.id === "draft"
        ? { ...s, when: { eq: "${item.label}", value: "answerable" } }
        : s
    );
    const ok = validateSpecV2(body, {
      services,
      knownConnections: ["reddit:default"],
    });
    assert.equal(ok.ok, true, JSON.stringify(ok.errors, null, 2));

    const bad = goodEngageLite();
    bad.steps = bad.steps.map((s) =>
      s.id === "draft"
        ? ({ ...s, when: { eq: 1, ne: 2 } } as unknown as (typeof bad.steps)[0])
        : s
    );
    const invalid = validateSpecV2(bad, {
      services,
      knownConnections: ["reddit:default"],
    });
    assert.equal(invalid.ok, false);
    assert.ok(invalid.errors.some((e) => e.code === "when_invalid"));
  });

  it("requires once on irreversible forEach under schedule trigger", () => {
    const body = goodEngageLite();
    body.trigger = { schedule: { cron: "0 9 * * 1-5" } };
    body.steps = body.steps.map((s) =>
      s.id === "post"
        ? {
            ...s,
            forEach: "${steps.draft.output}",
            args: {
              ...s.args,
              params: {
                thing_id: "${item.thing_id}",
                text: "${item.text}",
              },
            },
          }
        : s
    );
    const missing = validateSpecV2(body, {
      services,
      knownConnections: ["reddit:default"],
    });
    assert.equal(missing.ok, false);
    assert.ok(missing.errors.some((e) => e.code === "once_required"));

    body.steps = body.steps.map((s) =>
      s.id === "post" ? { ...s, once: "${item.thing_id}" } : s
    );
    const withOnce = validateSpecV2(body, {
      services,
      knownConnections: ["reddit:default"],
    });
    assert.equal(
      withOnce.ok,
      true,
      JSON.stringify(withOnce.errors, null, 2)
    );

    const badOnce = goodEngageLite();
    badOnce.trigger = { schedule: { cron: "0 9 * * *" } };
    badOnce.steps = badOnce.steps.map((s) =>
      s.id === "post"
        ? {
            ...s,
            forEach: "${steps.draft.output}",
            once: "not-a-ref",
            args: {
              ...s.args,
              params: {
                thing_id: "${item.thing_id}",
                text: "${item.text}",
              },
            },
          }
        : s
    );
    const bad = validateSpecV2(badOnce, {
      services,
      knownConnections: ["reddit:default"],
    });
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.some((e) => e.code === "once_not_ref"));
  });

  it("accepts schedule trigger and rejects poll unknown sourceStep", () => {
    const scheduled = goodEngageLite();
    scheduled.trigger = { schedule: { cron: "0 9 * * 1-5" } };
    const ok = validateSpecV2(scheduled, { services });
    assert.equal(ok.ok, true, JSON.stringify(ok.errors, null, 2));

    const badPoll = goodEngageLite();
    badPoll.trigger = {
      poll: { everyMs: 60_000, sourceStep: "missing_step" },
    };
    const bad = validateSpecV2(badPoll, { services });
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.some((e) => e.code === "trigger_poll_unknown_step"));

    const both = goodEngageLite();
    both.trigger = {
      manual: true,
      schedule: { cron: "0 * * * *" },
    } as SpecV2Body["trigger"];
    const invalid = validateSpecV2(both, { services });
    assert.equal(invalid.ok, false);
    // Dual-kind fails Spec body shape → code "structure" (trigger_* is for
    // post-shape semantic checks like unknown poll sourceStep).
    assert.ok(
      invalid.errors.some(
        (e) =>
          e.code === "structure" &&
          e.message.includes("exactly one of manual | schedule | poll")
      )
    );
  });

  it("parses Spec v2 YAML then validates", () => {
    const yaml = `
goal: Tiny demo
budget: { maxJobs: 1, dryRun: true }
rules:
  - id: always
    kind: hard
    check: { eq: 1, value: 1 }
steps:
  - id: ask
    use: human.approve
    args: { show: hello }
    enforce: [always]
  - id: note
    use: data.append
    args: { store: log, value: "\${steps.ask.output}" }
`;
    const body = parseSpecV2Yaml(yaml);
    const result = validateSpecV2(body);
    assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  });
});
