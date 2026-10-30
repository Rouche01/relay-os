import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SpecV2Body } from "@relay/protocol";
import {
  DEFAULT_HARD_MATCH_SUBJECT,
  looksLikeCollapsedRegexPattern,
  normalizeSpecV2HardChecks,
  parseSpecV2Yaml,
  validateSpecV2,
} from "../src/index.js";

describe("normalizeSpecV2HardChecks", () => {
  it("expands collapsed notMatches regex into subject + pattern", () => {
    const body: SpecV2Body = {
      goal: "test",
      steps: [{ id: "s", use: "llm.generate", args: { prompt: "x" } }],
      rules: [
        {
          id: "no_promo_links",
          kind: "hard",
          check: { notMatches: "https?://|www\\." } as never,
        },
      ],
    };
    const fixed = normalizeSpecV2HardChecks(body);
    const rule = fixed.rules![0]!;
    assert.equal(rule.kind, "hard");
    if (rule.kind !== "hard") return;
    const check = rule.check as { notMatches: string; pattern: string };
    assert.equal(check.notMatches, DEFAULT_HARD_MATCH_SUBJECT);
    assert.equal(check.pattern, "https?://|www\\.");
  });

  it("is idempotent when already well-formed", () => {
    const body: SpecV2Body = {
      goal: "test",
      steps: [{ id: "s", use: "llm.generate", args: { prompt: "x" } }],
      rules: [
        {
          id: "no_promo_links",
          kind: "hard",
          check: { notMatches: "${draft.text}", pattern: "https?://" },
        },
      ],
    };
    const fixed = normalizeSpecV2HardChecks(body);
    assert.equal(fixed, body);
  });

  it("parseSpecV2Yaml applies normalize", () => {
    const yaml = `
goal: Help fashion subs
steps:
  - id: draft
    use: llm.generate
    args:
      prompt: hi
    enforce: [no_promo_links]
rules:
  - id: no_promo_links
    kind: hard
    check:
      notMatches: https?://|www\\.
`;
    const body = parseSpecV2Yaml(yaml);
    const rule = body.rules![0]!;
    assert.equal(rule.kind, "hard");
    if (rule.kind !== "hard") return;
    const check = rule.check as { notMatches: string; pattern: string };
    assert.equal(check.notMatches, "${draft.text}");
    assert.equal(check.pattern, "https?://|www\\.");
  });
});

describe("looksLikeCollapsedRegexPattern", () => {
  it("detects regex-like collapse values", () => {
    assert.equal(looksLikeCollapsedRegexPattern("https?://"), true);
    assert.equal(looksLikeCollapsedRegexPattern("https?://|www\\."), true);
    assert.equal(looksLikeCollapsedRegexPattern("${draft.text}"), false);
    assert.equal(looksLikeCollapsedRegexPattern("plain prose"), false);
  });
});

describe("validateSpecV2 hard check shape", () => {
  it("errors when matches/notMatches lack pattern and are not collapsed regex", () => {
    const body: SpecV2Body = {
      goal: "test",
      steps: [
        {
          id: "draft",
          use: "llm.generate",
          args: { prompt: "x" },
          enforce: ["no_promo_links"],
        },
      ],
      rules: [
        {
          id: "no_promo_links",
          kind: "hard",
          // Ref subject but missing pattern — cannot auto-fix.
          check: { notMatches: "${draft.text}" } as never,
        },
      ],
    };
    const result = validateSpecV2(body);
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) => e.code === "hard_check_missing_pattern")
    );
  });
});
