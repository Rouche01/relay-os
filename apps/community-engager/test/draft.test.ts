import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { draftReply } from "../src/drafter.js";
import {
  buildDraftPrompt,
  clampModelIntensity,
  parseDraftModelJson,
} from "../src/draft-llm.js";
import {
  FIXTURE_THREADS,
  fixtureToDraftSkeleton,
} from "../src/fixtures/threads.js";
import type { RedditListingPost } from "../src/reddit/client.js";
import { listingPostsToDrafts } from "../src/reddit/map-drafts.js";
import type { CommunityDraft } from "../src/types.js";

const savedKey = process.env.GEMINI_API_KEY;

afterEach(() => {
  if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = savedKey;
});

function listingPost(overrides: Partial<RedditListingPost> = {}): RedditListingPost {
  return {
    id: "abc",
    name: "t3_abc",
    subreddit: "femalefashionadvice",
    title: "How do I build a work capsule when nothing fits?",
    selftext:
      "I keep buying pieces that do not work together. Looking for a simple system, not brand recs.",
    url: "https://www.reddit.com/r/femalefashionadvice/comments/abc",
    permalink: "https://www.reddit.com/r/femalefashionadvice/comments/abc",
    createdUtc: Math.floor(Date.now() / 1000),
    author: "op",
    ...overrides,
  };
}

function draft(overrides: Partial<CommunityDraft> = {}): CommunityDraft {
  return {
    id: "reddit-abc",
    platform: "reddit",
    subreddit: "femalefashionadvice",
    threadUrl: "https://www.reddit.com/r/femalefashionadvice/comments/abc",
    threadTitle: "Thick work Tshirts",
    opText: "Need shirts that survive a warehouse shift.",
    draftText: "",
    intensity: 0,
    score: {
      problemFit: true,
      wantsHelp: true,
      rulesOk: true,
      freshnessOk: true,
      valueWithoutApp: true,
    },
    rationale: "help ask",
    status: "proposed",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("listingPostsToDrafts opText", () => {
  it("copies a trimmed selftext onto the draft", () => {
    const [mapped] = listingPostsToDrafts(
      [listingPost({ selftext: "  Looking for a simple system that works together.  " })],
      3
    );
    assert.ok(mapped);
    assert.equal(
      mapped.opText,
      "Looking for a simple system that works together."
    );
    assert.equal(mapped.draftText, "");
    assert.equal(mapped.status, "proposed");
  });

  it("caps opText at 4000 characters", () => {
    const body = ` ${"a".repeat(5000)} `;
    const [mapped] = listingPostsToDrafts([listingPost({ selftext: body })], 3);
    assert.ok(mapped);
    assert.equal(mapped.opText?.length, 4000);
    assert.equal(mapped.opText, "a".repeat(4000));
  });

  it("copies fixture opText onto the skeleton", () => {
    const thread = FIXTURE_THREADS[0];
    assert.ok(thread);
    const skeleton = fixtureToDraftSkeleton(thread);
    assert.equal(skeleton.opText, thread.opText);
  });
});

describe("buildDraftPrompt", () => {
  it("includes the title, op body, memory, and intensity rules", () => {
    const prompt = buildDraftPrompt(
      draft(),
      "Human aborted a hard sell last week."
    );
    assert.match(prompt, /Thick work Tshirts/);
    assert.match(prompt, /warehouse shift/);
    assert.match(prompt, /Human aborted a hard sell last week/);
    assert.match(prompt, /Intensity rules:/);
    assert.match(prompt, /Do not mention GoStylens/);
    assert.match(prompt, /soft GoStylens/);
    assert.match(prompt, /founder disclosure/);
  });
});

describe("parseDraftModelJson", () => {
  it("parses a help-first reply", () => {
    const parsed = parseDraftModelJson(
      JSON.stringify({
        draftText: "  Start with two work shirts you already own.  ",
        intensity: 0,
        rationale: "direct answer",
      })
    );
    assert.deepEqual(parsed, {
      draftText: "Start with two work shirts you already own.",
      intensity: 0,
      rationale: "direct answer",
    });
  });

  it("clamps intensity 2 to 1 unless the comment discloses", () => {
    const soft = parseDraftModelJson(
      JSON.stringify({
        draftText: "Try a heavier cotton tee.",
        intensity: 2,
      })
    );
    assert.equal(soft?.intensity, 1);

    const disclosed = parseDraftModelJson(
      JSON.stringify({
        draftText: "Full disclosure: I built a small helper for this.",
        intensity: 2,
      })
    );
    assert.equal(disclosed?.intensity, 2);
  });

  it("forces intensity 0 on abort or spam memory", () => {
    const parsed = parseDraftModelJson(
      JSON.stringify({ draftText: "Audit what you already own.", intensity: 1 }),
      "Previous run: abort, too promo."
    );
    assert.equal(parsed?.intensity, 0);
    assert.equal(clampModelIntensity(2, "Audit what you already own.", "spam"), 0);
  });

  it("rejects a product mention when memory says help-first", () => {
    const parsed = parseDraftModelJson(
      JSON.stringify({
        draftText: "GoStylens can track the gaps.",
        intensity: 0,
      }),
      "Human called the last reply spam."
    );
    assert.equal(parsed, null);
  });

  it("rejects empty or invalid JSON", () => {
    assert.equal(parseDraftModelJson("{"), null);
    assert.equal(parseDraftModelJson(JSON.stringify({ draftText: "  ", intensity: 0 })), null);
    assert.equal(parseDraftModelJson(JSON.stringify({ intensity: 1 })), null);
  });
});

describe("draftReply stub fallback", () => {
  it("uses the stub when GEMINI_API_KEY is unset", async () => {
    delete process.env.GEMINI_API_KEY;
    const outcome = await draftReply(draft());
    assert.equal(outcome.provider, "stub");
    assert.equal(outcome.draft.status, "pending_approval");
    assert.match(outcome.draft.draftText, /3–5 roles your clothes need to cover/);
    assert.doesNotMatch(outcome.draft.draftText, /GoStylens/);
  });

  it("keeps an explicit text override on the stub even if a key is set", async () => {
    process.env.GEMINI_API_KEY = "test-key-not-used";
    const outcome = await draftReply(draft(), { text: "Edited by the human." });
    assert.equal(outcome.provider, "stub");
    assert.equal(outcome.draft.draftText, "Edited by the human.");
  });
});
