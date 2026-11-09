import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_ENGAGE_KIND,
  draftScoreSummary,
  engageKindOf,
  EMPTY_OPPORTUNITY_SCORE,
  isDraftActionable,
  normalizeEngageKind,
  type CreateProposal,
  type PresenceScore,
} from "../src/types.js";

describe("normalizeEngageKind", () => {
  it("accepts help / presence / create", () => {
    assert.equal(normalizeEngageKind("help"), "help");
    assert.equal(normalizeEngageKind("presence"), "presence");
    assert.equal(normalizeEngageKind("CREATE"), "create");
  });

  it("falls back to help for empty or unknown", () => {
    assert.equal(normalizeEngageKind(undefined), DEFAULT_ENGAGE_KIND);
    assert.equal(normalizeEngageKind(""), "help");
    assert.equal(normalizeEngageKind("nope"), "help");
  });
});

describe("engageKindOf", () => {
  it("defaults missing kind to help", () => {
    assert.equal(engageKindOf({}), "help");
    assert.equal(engageKindOf({ kind: undefined }), "help");
  });

  it("returns explicit kind", () => {
    assert.equal(engageKindOf({ kind: "presence" }), "presence");
  });
});

describe("CreateProposal shape", () => {
  it("locks create-lane fields for later pipeline", () => {
    const proposal: CreateProposal = {
      id: "create-1",
      kind: "create",
      platform: "reddit",
      subreddit: "malefashionadvice",
      title: "What I learned from one week of outfit logs",
      body: "Short original body.",
      patternSummary: "first-person lesson + one tip",
      sourcePostIds: ["t3_abc"],
      sourcePermalinks: [
        "https://www.reddit.com/r/malefashionadvice/comments/abc/x/",
      ],
      status: "proposed",
      createdAt: new Date().toISOString(),
    };
    assert.equal(proposal.kind, "create");
    assert.equal(proposal.sourcePostIds.length, 1);
  });
});

describe("isDraftActionable + draftScoreSummary", () => {
  const presenceOk: PresenceScore = {
    fashionFit: true,
    takeRoom: true,
    competition: true,
    freshnessOk: true,
    rulesOk: true,
    voiceFit: true,
  };

  it("uses presence score when kind is presence", () => {
    const draft = {
      kind: "presence" as const,
      score: EMPTY_OPPORTUNITY_SCORE,
      presenceScore: presenceOk,
    };
    assert.equal(isDraftActionable(draft), true);
    assert.deepEqual(draftScoreSummary(draft), { total: 6, max: 6 });
  });

  it("rejects presence drafts missing presenceScore", () => {
    assert.equal(
      isDraftActionable({
        kind: "presence",
        score: EMPTY_OPPORTUNITY_SCORE,
      }),
      false
    );
  });
});
