import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CommunityMemory } from "../src/memory.js";
import {
  detectDmInterest,
  outcomeTagEventId,
} from "../src/stages/learn/outcome-tags.js";
import { prefersHelpFirstMemory } from "../src/stages/draft/draft-llm.js";

describe("CommunityMemory.outcomeTag", () => {
  it("leads with tag= for VoltMem routing", () => {
    const fact = CommunityMemory.outcomeTag("got_reply", {
      draftId: "reddit-abc",
      subreddit: "fashion",
      threadUrl: "https://reddit.com/r/fashion/comments/1",
      note: "replies=2",
    });
    assert.match(fact, /^tag=got_reply/);
    assert.match(fact, /draft=reddit-abc/);
    assert.match(fact, /r\/fashion/);
    assert.match(fact, /replies=2/);
  });

  it("covers all four tags", () => {
    for (const tag of [
      "got_reply",
      "removed",
      "dm_interest",
      "signup_attributed",
    ] as const) {
      const fact = CommunityMemory.outcomeTag(tag, { subreddit: "x" });
      assert.match(fact, new RegExp(`tag=${tag}`));
    }
  });
});

describe("detectDmInterest", () => {
  it("flags DM-like reply text", () => {
    assert.equal(detectDmInterest([{ body: "thanks!" }]), false);
    assert.equal(detectDmInterest([{ body: "Can you DM me the link?" }]), true);
    assert.equal(detectDmInterest([{ body: "message me privately" }]), true);
  });
});

describe("outcomeTagEventId", () => {
  it("is stable per draft+tag", () => {
    assert.equal(
      outcomeTagEventId("removed", { draftId: "d1", subreddit: "fashion" }),
      "outcome:removed:d1"
    );
  });
});

describe("prefersHelpFirstMemory with removal tags", () => {
  it("treats tag=removed as help-first", () => {
    assert.equal(
      prefersHelpFirstMemory(
        "tag=removed; draft=x; r/fashion; comment removed or not publicly visible"
      ),
      true
    );
    assert.equal(
      prefersHelpFirstMemory("tag=got_reply; draft=x; r/fashion"),
      false
    );
  });
});
