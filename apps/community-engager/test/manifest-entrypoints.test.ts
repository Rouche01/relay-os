import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CommunityEngagerManifest,
  CommunityPostWatchManifest,
  manifestForEntrypoint,
} from "../src/manifest.js";

describe("manifest entrypoints (A0)", () => {
  it("engage parent no longer includes post_watch", () => {
    const names = CommunityEngagerManifest.stages.map((s) => s.name);
    assert.deepEqual(names, [
      "ensure_session",
      "discover",
      "scout",
      "jobs",
    ]);
    assert.ok(!names.includes("post_watch"));
  });

  it("post_watch entrypoint is poll then jobs only", () => {
    const names = CommunityPostWatchManifest.stages.map((s) => s.name);
    assert.deepEqual(names, ["post_watch", "jobs"]);
    const jobs = CommunityPostWatchManifest.stages.find((s) => s.name === "jobs");
    assert.ok(jobs?.fanout?.manifest);
  });

  it("manifestForEntrypoint selects the right root", () => {
    assert.equal(manifestForEntrypoint("engage").name, "CommunityEngager");
    assert.equal(manifestForEntrypoint("post_watch").name, "CommunityPostWatch");
    assert.equal(manifestForEntrypoint().name, "CommunityEngager");
  });
});
