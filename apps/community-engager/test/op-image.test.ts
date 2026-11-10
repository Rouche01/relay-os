import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fetchOpImageAsDataUrl,
  resolveOpImageUrl,
} from "../src/stages/draft/op-image.js";
import { buildDraftPrompt } from "../src/stages/draft/draft-llm.js";
import type { CommunityDraft } from "../src/types.js";

function baseDraft(
  over: Partial<CommunityDraft> = {}
): CommunityDraft {
  return {
    id: "t1",
    platform: "reddit",
    subreddit: "malefashionadvice",
    threadUrl: "https://www.reddit.com/r/malefashionadvice/comments/abc/fit/",
    threadTitle: "Fit check for a wedding",
    opText: "",
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
      plugNaturalness: false,
    },
    rationale: "test",
    status: "proposed",
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe("resolveOpImageUrl", () => {
  it("returns i.redd.it urls", () => {
    assert.equal(
      resolveOpImageUrl({
        postUrl: "https://i.redd.it/abc123.jpg",
        threadUrl: "https://www.reddit.com/r/x/comments/abc/",
      }),
      "https://i.redd.it/abc123.jpg"
    );
  });

  it("skips galleries and permalink-only urls", () => {
    assert.equal(
      resolveOpImageUrl({
        postUrl: "https://www.reddit.com/gallery/xyz",
        threadUrl: "https://www.reddit.com/r/x/comments/abc/",
      }),
      undefined
    );
    assert.equal(
      resolveOpImageUrl({
        postUrl: "https://www.reddit.com/r/x/comments/abc/",
        threadUrl: "https://www.reddit.com/r/x/comments/abc/",
      }),
      undefined
    );
  });
});

describe("fetchOpImageAsDataUrl", () => {
  it("builds a data url from image bytes", async () => {
    // Minimal JPEG SOI + EOI
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const fetched = await fetchOpImageAsDataUrl("https://i.redd.it/x.jpg", {
      fetchImpl: async () =>
        new Response(jpeg, {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
    });
    assert.ok(fetched);
    assert.equal(fetched!.mimeType, "image/jpeg");
    assert.match(fetched!.dataUrl, /^data:image\/jpeg;base64,/);
  });

  it("returns null for non-image content-type", async () => {
    const fetched = await fetchOpImageAsDataUrl("https://example.com/x", {
      fetchImpl: async () =>
        new Response("not image", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    });
    assert.equal(fetched, null);
  });
});

describe("buildDraftPrompt imageAttached", () => {
  it("switches media instructions when image is attached", () => {
    const draft = baseDraft({
      postUrl: "https://i.redd.it/abc123.jpg",
      opMediaHint: "OP included photo(s)… cannot see the pixels…",
    });
    const blind = buildDraftPrompt(draft);
    assert.match(blind, /cannot see/i);
    const vision = buildDraftPrompt(draft, undefined, { imageAttached: true });
    assert.match(vision, /image is attached/i);
    assert.doesNotMatch(vision, /cannot see the pixels/i);
  });
});
