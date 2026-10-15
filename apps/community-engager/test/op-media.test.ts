import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inferOpMedia } from "../src/stages/draft/op-media.js";

describe("inferOpMedia", () => {
  it("detects i.redd.it images", () => {
    const m = inferOpMedia({
      title: "Help styling these for a live taping",
      opText: "",
      postUrl: "https://i.redd.it/abc123.jpg",
    });
    assert.equal(m.kind, "image");
    assert.match(m.hint ?? "", /cannot see/i);
  });

  it("detects galleries", () => {
    const m = inferOpMedia({
      title: "Outfit help",
      postUrl: "https://www.reddit.com/gallery/xyz",
    });
    assert.equal(m.kind, "gallery");
  });

  it("infers image when thin body + deictic title", () => {
    const m = inferOpMedia({
      title: "Help styling these for a live taping",
      opText: "",
      postUrl: "https://www.reddit.com/r/fashion/comments/abc",
    });
    assert.equal(m.kind, "image");
  });

  it("returns none for text-only help posts", () => {
    const m = inferOpMedia({
      title: "How do I build a work capsule?",
      opText:
        "I keep buying pieces that do not work together. Looking for a simple system.",
      postUrl: "https://www.reddit.com/r/femalefashionadvice/comments/abc",
    });
    assert.equal(m.kind, "none");
    assert.equal(m.hint, undefined);
  });
});
