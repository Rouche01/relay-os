import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  contentHasImage,
  parseDataUrl,
  partsText,
} from "../src/content-parts.js";
import { _toGeminiPartsForTest } from "../src/gemini.js";

describe("parseDataUrl", () => {
  it("parses jpeg data urls", () => {
    const p = parseDataUrl("data:image/jpeg;base64,abc123");
    assert.deepEqual(p, { mimeType: "image/jpeg", data: "abc123" });
  });

  it("returns null for https urls", () => {
    assert.equal(parseDataUrl("https://i.redd.it/x.jpg"), null);
  });
});

describe("contentHasImage / partsText", () => {
  it("detects image parts", () => {
    assert.equal(contentHasImage("hello"), false);
    assert.equal(
      contentHasImage([
        { type: "text", text: "hi" },
        { type: "image_url", url: "data:image/png;base64,xx" },
      ]),
      true
    );
    assert.equal(
      partsText([
        { type: "text", text: "a" },
        { type: "image_url", url: "data:image/png;base64,xx" },
        { type: "text", text: "b" },
      ]),
      "a\nb"
    );
  });
});

describe("gemini image parts", () => {
  it("maps data urls to inlineData", () => {
    const parts = _toGeminiPartsForTest([
      { type: "text", text: "look" },
      { type: "image_url", url: "data:image/jpeg;base64,QQ==" },
    ]);
    assert.deepEqual(parts, [
      { text: "look" },
      { inlineData: { mimeType: "image/jpeg", data: "QQ==" } },
    ]);
  });
});
