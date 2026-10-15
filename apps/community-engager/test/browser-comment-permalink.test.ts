import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isCommentPermalink } from "../src/reddit/write/browser-comment.js";

describe("isCommentPermalink", () => {
  it("accepts comment and t1_ URLs", () => {
    assert.equal(
      isCommentPermalink(
        "https://www.reddit.com/r/foo/comments/abc/title/comment/xyz/"
      ),
      true
    );
    assert.equal(
      isCommentPermalink(
        "https://www.reddit.com/r/foo/comments/abc/title/t1_abc123/"
      ),
      true
    );
  });

  it("rejects bare thread URLs and empty", () => {
    assert.equal(
      isCommentPermalink("https://www.reddit.com/r/foo/comments/abc/title/"),
      false
    );
    assert.equal(isCommentPermalink(""), false);
  });
});
