import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createProposalToDraft } from "../src/stages/create/proposal-to-draft.js";
import { stubRemodel } from "../src/stages/create/remodel.js";
import {
  createCooldownActive,
} from "../src/stages/create/winner-scout.js";
import type { CreateProposal } from "../src/types.js";
import { formatManualPostNotify } from "../src/stages/execute/manual-notify.js";

describe("create remodel helpers", () => {
  it("stubRemodel produces original-looking title/body", () => {
    const out = stubRemodel(
      [{ title: "Fit check: linen shirt + wide pants", body: "Went out…" }],
      "malefashionadvice"
    );
    assert.match(out.patternSummary, /First-person/i);
    assert.ok(out.title.length > 8);
    assert.ok(out.body.includes("r/malefashionadvice"));
    assert.ok(!out.body.includes("linen shirt + wide pants"));
  });

  it("createCooldownActive gates same-sub create within window", () => {
    const now = Date.parse("2026-11-09T12:00:00Z");
    const entries = [
      {
        postedAt: new Date(now - 2 * 86_400_000).toISOString(),
        kind: "create" as const,
        subreddit: "malefashionadvice",
        intensity: 0 as const,
      },
    ];
    assert.equal(
      createCooldownActive(entries, "malefashionadvice", 7, now),
      true
    );
    assert.equal(createCooldownActive(entries, "streetwear", 7, now), false);
    assert.equal(
      createCooldownActive(entries, "malefashionadvice", 1, now),
      false
    );
  });

  it("createProposalToDraft maps into CommunityDraft for jobs", () => {
    const proposal: CreateProposal = {
      id: "create-test-1",
      kind: "create",
      platform: "reddit",
      subreddit: "malefashionadvice",
      title: "What I learned rotating three jackets",
      body: "Body text here.",
      patternSummary: "lesson + tip",
      sourcePostIds: ["t3_abc"],
      sourcePermalinks: ["https://reddit.com/r/malefashionadvice/comments/abc"],
      status: "proposed",
      createdAt: new Date().toISOString(),
      rationale: "stub",
    };
    const draft = createProposalToDraft(proposal);
    assert.equal(draft.kind, "create");
    assert.equal(draft.threadTitle, proposal.title);
    assert.equal(draft.draftText, proposal.body);
    assert.equal(draft.intensity, 0);
    assert.match(formatManualPostNotify(draft), /Create original post/);
    assert.match(formatManualPostNotify(draft), /Body text here/);
  });
});
