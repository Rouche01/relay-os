import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SpecV2HardRule } from "@relay/protocol";
import {
  EnforceError,
  enforceRules,
  evaluateHardRule,
} from "../src/index.js";

describe("evaluateHard", () => {
  it("notMatches / eq / in", () => {
    const noPromo: SpecV2HardRule = {
      id: "no_promo_links",
      kind: "hard",
      check: { notMatches: "${draft.text}", pattern: "https?://" },
    };
    assert.equal(
      evaluateHardRule(noPromo, { draft: { text: "helpful tip" } }),
      true
    );
    assert.equal(
      evaluateHardRule(noPromo, { draft: { text: "see https://spam.com" } }),
      false
    );

    const allow: SpecV2HardRule = {
      id: "allowlist",
      kind: "hard",
      check: { in: "${item.sub}", list: ["a", "b"] },
    };
    assert.equal(evaluateHardRule(allow, { item: { sub: "a" } }), true);
    assert.equal(evaluateHardRule(allow, { item: { sub: "z" } }), false);

    const eq: SpecV2HardRule = {
      id: "status",
      kind: "hard",
      check: { eq: "${output.status}", value: "ok" },
    };
    assert.equal(evaluateHardRule(eq, { output: { status: "ok" } }), true);
  });
});

describe("enforceRules", () => {
  it("fails closed on hard rule", async () => {
    await assert.rejects(
      () =>
        enforceRules({
          ruleIds: ["no_promo"],
          rules: [
            {
              id: "no_promo",
              kind: "hard",
              check: { notMatches: "${output.text}", pattern: "http" },
            },
          ],
          output: { text: "http://x" },
          scope: {},
        }),
      (err: unknown) => err instanceof EnforceError
    );
  });

  it("fails closed on soft without llm when softFailClosed", async () => {
    await assert.rejects(
      () =>
        enforceRules({
          ruleIds: ["helpful"],
          rules: [
            {
              id: "helpful",
              kind: "soft",
              judge: { rubric: ["fit"], minMean: 3 },
            },
          ],
          output: { text: "hi" },
          scope: {},
          softFailClosed: true,
        }),
      EnforceError
    );
  });

  it("skips soft without llm when softFailClosed=false", async () => {
    const results = await enforceRules({
      ruleIds: ["helpful"],
      rules: [
        {
          id: "helpful",
          kind: "soft",
          judge: { rubric: ["fit"], minMean: 3 },
        },
      ],
      output: { text: "hi" },
      scope: {},
      softFailClosed: false,
    });
    assert.equal(results[0]?.passed, true);
    assert.equal(results[0]?.detail?.skipped, "soft_unevaluated");
  });
});
