import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { draftReply, stripEmDashes } from "../src/stages/draft/drafter.js";
import type { LlmClient } from "@relay/llm";
import {
  buildDraftPrompt,
  buildPresenceDraftPrompt,
  clampModelIntensity,
  generateDraftViaLlm,
  parseDraftModelJson,
  presenceForcesIntensity0,
  resolveDraftLlmProvider,
} from "../src/stages/draft/draft-llm.js";
import {
  FIXTURE_THREADS,
  fixtureToDraftSkeleton,
} from "../src/fixtures/threads.js";
import { DEFAULT_PLAYBOOK } from "../src/policy/playbook.js";
import type { RedditListingPost } from "../src/reddit/client.js";
import { listingPostsToDrafts } from "../src/reddit/scout/map-drafts.js";
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
      competition: true,
      icpFit: true,
      plugNaturalness: true,
    },

    rationale: "help ask",
    status: "proposed",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("listingPostsToDrafts kind", () => {
  it("defaults skeletons to help", () => {
    const [mapped] = listingPostsToDrafts(
      [listingPost({ selftext: "Looking for a simple system that works together." })],
      3
    );
    assert.ok(mapped);
    assert.equal(mapped.kind, "help");
  });

  it("presence lane maps fit-checks when playbook opts in", () => {
    const [mapped] = listingPostsToDrafts(
      [
        listingPost({
          title: "Fit check — dinner outfit",
          selftext: "Too dressy? Honest thoughts.",
          url: "https://i.redd.it/abc.jpg",
          isSelf: false,
        }),
      ],
      3,
      {
        kind: "presence",
        playbookFor: () => ({
          ...DEFAULT_PLAYBOOK,
          presenceEnabled: true,
        }),
      }
    );
    assert.ok(mapped);
    assert.equal(mapped.kind, "presence");
    assert.ok(mapped.presenceScore);
    assert.equal(mapped.presenceScore?.fashionFit, true);
  });

  it("presence lane yields nothing when playbook.presenceEnabled is off", () => {
    const drafts = listingPostsToDrafts(
      [
        listingPost({
          title: "Fit check — dinner outfit",
          selftext: "Too dressy?",
          url: "https://i.redd.it/abc.jpg",
          isSelf: false,
        }),
      ],
      3,
      { kind: "presence" }
    );
    assert.equal(drafts.length, 0);
  });
});

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
    assert.match(prompt, /Soft-CTA pattern/);
    assert.match(prompt, /Voice \(required\)/);
    assert.match(prompt, /Ban AI\/coach\/retail tells/);
    assert.match(prompt, /Em dashes and en dashes: never/);
    assert.doesNotMatch(prompt, /almost never/);
    assert.doesNotMatch(prompt, /—/);
    assert.match(prompt, /From the pic\/pics, yeah/);
    assert.match(prompt, /check out X or Y/);
    assert.match(prompt, /Do not mention GoStylens/);
    assert.match(prompt, /mention by name only/);
    assert.match(prompt, /founder disclosure/);
  });

  it("adds photo constraints for image / deictic posts", () => {
    const prompt = buildDraftPrompt(
      draft({
        threadTitle: "Help styling these for a live taping",
        opText: "",
        postUrl: "https://i.redd.it/abc123.jpg",
      })
    );
    assert.match(prompt, /PHOTO \/ MEDIA CONSTRAINT/);
    assert.match(prompt, /cannot see/i);
    assert.match(prompt, /do not invent colors/i);
    assert.match(prompt, /skip stock openers/i);
    assert.doesNotMatch(prompt, /from the pics…/i);
    assert.doesNotMatch(prompt, /—/);
    assert.match(prompt, /live taping/);
  });
});

describe("listingPostsToDrafts opMediaHint", () => {
  it("sets opMediaHint when the listing url is an image", () => {
    const [mapped] = listingPostsToDrafts(
      [
        listingPost({
          title: "Help styling these for a live taping",
          selftext: "",
          url: "https://i.redd.it/abc123.jpg",
        }),
      ],
      3
    );
    assert.ok(mapped?.opMediaHint);
    assert.match(mapped!.opMediaHint!, /photo/i);
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

describe("resolveDraftLlmProvider", () => {
  it("defaults to gemini and accepts anthropic", () => {
    assert.equal(resolveDraftLlmProvider({}), "gemini");
    assert.equal(
      resolveDraftLlmProvider({ COMMUNITY_DRAFT_LLM: "anthropic" }),
      "anthropic"
    );
  });
});

describe("generateDraftViaLlm", () => {
  it("passes the prompt through a fake LlmClient", async () => {
    const fake: LlmClient = {
      provider: "anthropic",
      async completeJson(req) {
        assert.match(req.messages.map((m) => String(m.content)).join(""), /warehouse shift/);
        assert.equal(req.schema.type, "object");
        return {
          text: JSON.stringify({
            draftText: "Start with the shirts you already named.",
            intensity: 0,
          }),
          provider: "anthropic",
          model: "claude-sonnet-4-5",
        };
      },
    };
    const parsed = await generateDraftViaLlm({
      draft: draft(),
      client: fake,
    });
    assert.equal(parsed.provider, "anthropic");
    assert.equal(parsed.model, "claude-sonnet-4-5");
    assert.match(parsed.draftText, /shirts you already named/);
    assert.equal(parsed.intensity, 0);
  });
});

describe("stripEmDashes", () => {
  it("turns sentence-like dashes into periods and others into commas", () => {
    assert.equal(
      stripEmDashes("pleated trousers styled casually — You'd want mid rise."),
      "pleated trousers styled casually. You'd want mid rise."
    );
    assert.equal(
      stripEmDashes("the coherent part — just the name, no link"),
      "the coherent part, just the name, no link"
    );
    assert.equal(
      stripEmDashes("fit–check with space – and more"),
      "fit, check with space, and more"
    );
    assert.doesNotMatch(stripEmDashes("a — b – c"), /[—–]/);
  });
});

describe("draftReply stub fallback", () => {
  it("uses the stub when the selected provider has no API key", async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.COMMUNITY_DRAFT_LLM;
    const outcome = await draftReply(draft());
    assert.equal(outcome.provider, "stub");
    assert.equal(outcome.draft.status, "pending_approval");
    assert.equal(outcome.draft.draftProvider, "stub");
    assert.equal(outcome.draft.draftModel, "stub");
    assert.match(outcome.draft.draftText, /I'd lean on what you already called out/);
    assert.doesNotMatch(outcome.draft.draftText, /GoStylens/);
    assert.doesNotMatch(outcome.draft.draftText, /[—–]/);
    assert.doesNotMatch(outcome.draft.draftText, /1\)/);
  });

  it("strips em dashes from human text overrides too", async () => {
    process.env.GEMINI_API_KEY = "test-key-not-used";
    const outcome = await draftReply(draft(), {
      text: "Edited by the human — still casual.",
    });
    assert.equal(outcome.provider, "stub");
    assert.equal(outcome.draft.draftProvider, "stub");
    assert.equal(outcome.draft.draftModel, "stub");
    assert.equal(outcome.draft.draftText, "Edited by the human, still casual.");
    assert.doesNotMatch(outcome.draft.draftText, /[—–]/);
  });

  it("presence lane uses short stub and forces intensity 0", async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const outcome = await draftReply(
      draft({
        kind: "presence",
        threadTitle: "Fit check — navy trousers + white tee for drinks?",
        intensity: 1,
        opMediaHint: "OP included photo(s).",
      })
    );
    assert.equal(outcome.provider, "stub");
    assert.equal(outcome.draft.intensity, 0);
    assert.match(outcome.draft.draftText, /drinks/i);
    assert.doesNotMatch(outcome.draft.draftText, /GoStylens/i);
    assert.ok(presenceForcesIntensity0(outcome.draft));
  });
});

describe("buildPresenceDraftPrompt", () => {
  it("requires intensity 0 and bans product plugs", () => {
    const prompt = buildPresenceDraftPrompt(
      draft({
        kind: "presence",
        threadTitle: "Rate my outfit",
        opText: "Wedding guest look.",
      })
    );
    assert.match(prompt, /PRESENCE MODE/);
    assert.match(prompt, /Intensity must be 0/);
    assert.match(prompt, /Do not mention GoStylens/);
    assert.match(prompt, /1-2 short sentences/);
    assert.match(prompt, /compliment \+ one concrete detail/i);
    assert.match(prompt, /Do NOT coach/i);
    assert.doesNotMatch(prompt, /Soft-CTA pattern/);
  });

  it("generateDraftViaLlm routes presence prompts", async () => {
    const fake: LlmClient = {
      provider: "gemini",
      async completeJson(req) {
        const content = req.messages.map((m) => String(m.content)).join("");
        assert.match(content, /PRESENCE MODE/);
        assert.match(content, /Fit check/);
        return {
          text: JSON.stringify({
            draftText: "That tee + trousers for drinks works if you keep shoes sharp.",
            intensity: 1,
          }),
          provider: "gemini",
          model: "gemini-2.5-flash",
        };
      },
    };
    const parsed = await generateDraftViaLlm({
      draft: draft({
        kind: "presence",
        threadTitle: "Fit check for drinks",
      }),
      client: fake,
    });
    assert.equal(parsed.intensity, 0);
    assert.match(parsed.draftText, /drinks/);
  });
});
