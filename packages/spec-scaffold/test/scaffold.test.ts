import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { LlmClient, LlmJsonRequest, LlmJsonResult } from "@relay/llm";
import { messageText } from "@relay/llm";
import {
  parseServiceDescriptorYaml,
  type SpecV2Body,
} from "@relay/protocol";
import {
  formatCatalogForPrompt,
  needsFromIntent,
  proposeSlotsFromIntent,
  scaffoldSpec,
  specBodyToYaml,
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
  throw new Error(`missing ${name}`);
}

const services = [
  loadService("reddit-public.yaml"),
  loadService("reddit-oauth.yaml"),
];

function goodBody(): SpecV2Body {
  return {
    goal: "Help fashion subs with useful replies",
    connections: ["reddit:default"],
    services: ["reddit-public", "reddit-oauth"],
    budget: { maxJobs: 2, dryRun: true },
    rules: [
      {
        id: "no_promo_links",
        kind: "hard",
        check: { notMatches: "${draft.text}", pattern: "https?://" },
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
      },
      {
        id: "draft",
        use: "llm.generate",
        forEach: "${steps.scout.output.body.posts}",
        args: { prompt: "Draft a reply", input: "${item}" },
        enforce: ["no_promo_links"],
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
          params: { thing_id: "t3_x", text: "hi" },
        },
      },
    ],
  };
}

function stubClient(handler: (req: LlmJsonRequest) => unknown): LlmClient {
  return {
    provider: "gemini",
    async completeJson(req: LlmJsonRequest): Promise<LlmJsonResult> {
      const body = handler(req);
      return {
        text: JSON.stringify(body),
        provider: "gemini",
        model: "stub",
      };
    },
  };
}

describe("formatCatalogForPrompt", () => {
  it("lists catalog capability ids", () => {
    const text = formatCatalogForPrompt();
    assert.match(text, /api\.request/);
    assert.match(text, /human\.approve/);
    assert.match(text, /llm\.generate/);
  });
});

describe("scaffoldSpec", () => {
  it("returns a valid Spec on first draft", async () => {
    const result = await scaffoldSpec({
      intent: "Help fashion subreddits; approve before posting",
      client: stubClient(() => goodBody()),
      services,
      knownConnections: ["reddit:default"],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.attempts, 1);
    assert.equal(result.body.steps.length, 4);
    assert.match(result.yaml, /goal:/);
    assert.match(specBodyToYaml(result.body), /human\.approve/);
  });

  it("repairs after validator errors (max 3)", async () => {
    let calls = 0;
    const client = stubClient((req) => {
      calls += 1;
      const user = req.messages.map((m) => messageText(m.content)).join("\n");
      if (calls === 1) {
        const bad = goodBody();
        bad.steps[0]!.use = "llm.invent";
        return bad;
      }
      assert.match(user, /unknown_capability|Validator errors/i);
      return goodBody();
    });

    const result = await scaffoldSpec({
      intent: "Help fashion subs",
      client,
      services,
      knownConnections: ["reddit:default"],
      maxRepairs: 3,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.attempts, 2);
    assert.equal(calls, 2);
    assert.equal(result.history[0]?.kind, "draft");
    assert.equal(result.history[1]?.kind, "repair");
  });

  it("stops and reports errors when repairs exhausted", async () => {
    const result = await scaffoldSpec({
      intent: "Do a thing",
      client: stubClient(() => {
        const bad = goodBody();
        bad.steps[0]!.use = "llm.invent";
        return bad;
      }),
      services,
      knownConnections: ["reddit:default"],
      maxRepairs: 2,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.attempts, 3);
    assert.ok(result.errors.some((e) => e.code === "unknown_capability"));
    assert.match(result.message, /still invalid/i);
  });

  it("rejects empty intent without calling the model", async () => {
    let called = false;
    const result = await scaffoldSpec({
      intent: "  ",
      client: stubClient(() => {
        called = true;
        return goodBody();
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(called, false);
  });

  it("preflight returns needs for unknown product without calling LLM", async () => {
    let called = false;
    const result = await scaffoldSpec({
      intent: "Every morning summarize my Gmail inbox and Slack me the top 3",
      client: stubClient(() => {
        called = true;
        return goodBody();
      }),
      services,
      knownConnections: ["reddit:default"],
    });
    assert.equal(result.ok, false);
    assert.equal(called, false);
    if (result.ok) return;
    assert.ok(result.needs?.some((n) => n.id === "gmail"));
    assert.ok(result.needs?.some((n) => n.action === "import_descriptor"));
    assert.equal(result.attempts, 0);
  });

  it("aborts repair loop when draft invents an unknown service", async () => {
    let calls = 0;
    const result = await scaffoldSpec({
      intent: "Help fashion subs",
      client: stubClient(() => {
        calls += 1;
        const bad = goodBody();
        bad.services = ["stripe"];
        bad.steps[0]!.args = {
          service: "stripe",
          operation: "chargesCreate",
          params: {},
        };
        return bad;
      }),
      services,
      knownConnections: ["reddit:default"],
      maxRepairs: 3,
      preflightNeeds: false,
    });
    assert.equal(result.ok, false);
    assert.equal(calls, 1);
    if (result.ok) return;
    assert.ok(result.needs?.some((n) => n.kind === "service" && n.id === "stripe"));
    assert.equal(result.attempts, 1);
  });
});

describe("needsFromIntent (cs2 capability slots)", () => {
  it("does not Needs when github missing — scm.issues still has human candidate", () => {
    const needs = needsFromIntent(
      "Triage GitHub issues labeled bug",
      services,
      ["reddit:default"]
    );
    assert.equal(needs.length, 0);
  });

  it("does not Needs for missing github connection when slot has viable alternatives", () => {
    const withGithub = [
      ...services,
      {
        id: "github",
        baseUrl: "https://api.github.com",
        auth: { type: "bearer" as const, connection: true as const },
        operations: [
          {
            id: "issuesListForRepo",
            method: "GET" as const,
            path: "/repos/{owner}/{repo}/issues",
          },
        ],
      },
    ];
    const needs = needsFromIntent(
      "Triage GitHub issues labeled bug",
      withGithub,
      ["reddit:default"]
    );
    assert.equal(needs.length, 0);
  });

  it("is empty for Reddit when catalog covers read path", () => {
    const needs = needsFromIntent(
      "Help fashion subreddits with useful replies",
      services,
      ["reddit:default"]
    );
    assert.equal(needs.length, 0);
  });

  it("YouTube intent does not Needs — youtube.discover has non-blocked candidates", () => {
    const needs = needsFromIntent(
      "Every day find YouTube creators with Nigerian audience",
      services,
      []
    );
    assert.equal(needs.length, 0);
  });

  it("still Needs for non-vocab services (stripe)", () => {
    const needs = needsFromIntent("Charge customers via Stripe", services, []);
    assert.ok(needs.some((n) => n.kind === "service" && n.id === "stripe"));
  });
});

describe("proposeSlotsFromIntent", () => {
  it("emits youtube.discover with unresolved candidates", () => {
    const slots = proposeSlotsFromIntent({
      intent: "Discover YouTube creators in Nigeria by niche",
      catalog: services,
      knownConnections: [],
    });
    assert.equal(slots.length, 1);
    assert.equal(slots[0]!.id, "youtube.discover");
    assert.equal(slots[0]!.resolved, null);
    assert.ok(slots[0]!.candidates.length >= 2);
    assert.ok(
      slots[0]!.candidates.some((c) => c.status !== "blocked"),
      "expected a viable candidate"
    );
  });
});
