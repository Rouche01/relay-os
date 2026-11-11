import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fetchOpImageAsDataUrl,
  resolveGalleryImagesViaCommentsJson,
  resolveOpImageUrl,
  resolveOpImageUrlsAsync,
} from "../src/stages/draft/op-image.js";
import { extractImageUrlsFromListingData } from "../src/reddit/listing-image.js";
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

  it("prefers imageUrl over gallery postUrl", () => {
    assert.equal(
      resolveOpImageUrl({
        imageUrl: "https://i.redd.it/slide1.jpg",
        postUrl: "https://www.reddit.com/gallery/xyz",
        threadUrl: "https://www.reddit.com/r/x/comments/xyz/",
      }),
      "https://i.redd.it/slide1.jpg"
    );
  });

  it("skips galleries sync and permalink-only urls", () => {
    assert.equal(
      resolveOpImageUrl({
        postUrl: "https://www.reddit.com/gallery/xyz",
        threadUrl: "https://www.reddit.com/r/x/comments/abc/",
      }),
      undefined
    );
  });
});

describe("extractImageUrlsFromListingData", () => {
  it("reads up to 5 gallery slides in order", () => {
    const items = [1, 2, 3, 4, 5, 6].map((n) => ({
      media_id: `m${n}`,
      id: n - 1,
    }));
    const meta: Record<string, unknown> = {};
    for (let n = 1; n <= 6; n++) {
      meta[`m${n}`] = {
        status: "valid",
        e: "Image",
        s: { u: `https://i.redd.it/slide${n}.jpg` },
      };
    }
    const urls = extractImageUrlsFromListingData(
      {
        url: "https://www.reddit.com/gallery/abc",
        gallery_data: { items },
        media_metadata: meta,
      },
      5
    );
    assert.deepEqual(urls, [
      "https://i.redd.it/slide1.jpg",
      "https://i.redd.it/slide2.jpg",
      "https://i.redd.it/slide3.jpg",
      "https://i.redd.it/slide4.jpg",
      "https://i.redd.it/slide5.jpg",
    ]);
  });
});

describe("resolveOpImageUrlsAsync gallery", () => {
  it("resolves multiple gallery images via comments JSON", async () => {
    const urls = await resolveOpImageUrlsAsync(
      {
        postUrl: "https://www.reddit.com/gallery/abc123",
        threadUrl:
          "https://www.reddit.com/r/mensfashion/comments/abc123/loafers/",
      },
      {
        maxImages: 5,
        fetchImpl: async () =>
          new Response(
            JSON.stringify([
              {
                data: {
                  children: [
                    {
                      data: {
                        id: "abc123",
                        url: "https://www.reddit.com/gallery/abc123",
                        gallery_data: {
                          items: [
                            { media_id: "m1" },
                            { media_id: "m2" },
                            { media_id: "m3" },
                          ],
                        },
                        media_metadata: {
                          m1: {
                            status: "valid",
                            e: "Image",
                            s: { u: "https://i.redd.it/a.jpg" },
                          },
                          m2: {
                            status: "valid",
                            e: "Image",
                            s: { u: "https://i.redd.it/b.jpg" },
                          },
                          m3: {
                            status: "valid",
                            e: "Image",
                            s: { u: "https://i.redd.it/c.jpg" },
                          },
                        },
                      },
                    },
                  ],
                },
              },
              { data: { children: [] } },
            ]),
            { status: 200, headers: { "content-type": "application/json" } }
          ),
      }
    );
    assert.deepEqual(urls, [
      "https://i.redd.it/a.jpg",
      "https://i.redd.it/b.jpg",
      "https://i.redd.it/c.jpg",
    ]);
  });

  it("resolveGalleryImagesViaCommentsJson respects maxImages", async () => {
    const urls = await resolveGalleryImagesViaCommentsJson(
      { threadUrl: "https://www.reddit.com/r/x/comments/zz99/t/" },
      {
        maxImages: 2,
        fetchImpl: async () =>
          new Response(
            JSON.stringify([
              {
                data: {
                  children: [
                    {
                      data: {
                        gallery_data: {
                          items: [
                            { media_id: "a" },
                            { media_id: "b" },
                            { media_id: "c" },
                          ],
                        },
                        media_metadata: {
                          a: {
                            status: "valid",
                            e: "Image",
                            s: { u: "https://i.redd.it/1.jpg" },
                          },
                          b: {
                            status: "valid",
                            e: "Image",
                            s: { u: "https://i.redd.it/2.jpg" },
                          },
                          c: {
                            status: "valid",
                            e: "Image",
                            s: { u: "https://i.redd.it/3.jpg" },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            ]),
            { status: 200 }
          ),
      }
    );
    assert.deepEqual(urls, [
      "https://i.redd.it/1.jpg",
      "https://i.redd.it/2.jpg",
    ]);
  });
});

describe("fetchOpImageAsDataUrl", () => {
  it("builds a data url from image bytes", async () => {
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
    const vision = buildDraftPrompt(draft, undefined, {
      imageAttached: true,
      imageCount: 1,
    });
    assert.match(vision, /image is attached/i);
    assert.doesNotMatch(vision, /cannot see the pixels/i);
  });

  it("mentions gallery slide count when multiple images attached", () => {
    const draft = baseDraft({ postUrl: "https://www.reddit.com/gallery/x" });
    const vision = buildDraftPrompt(draft, undefined, {
      imageAttached: true,
      imageCount: 3,
    });
    assert.match(vision, /3 OP images/i);
    assert.match(vision, /gallery order|slide 1/i);
  });
});
