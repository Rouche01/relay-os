import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { mergeConfig, resetAppConfigCache } from "../src/app-config.js";
import { getCommunityConfig } from "../src/reddit/config.js";
import { executeApproved } from "../src/stages/execute/executor.js";
import type { CommunityDraft } from "../src/types.js";

function sampleDraft(): CommunityDraft {
  return {
    id: "reddit-post-mode-test",
    platform: "reddit",
    subreddit: "test",
    threadUrl: "https://www.reddit.com/r/test/comments/abc/title/",
    threadTitle: "test thread",
    draftText: "helpful reply without plugs",
    intensity: 0,
    score: {
      problemFit: true,
      wantsHelp: true,
      rulesOk: true,
      freshnessOk: true,
      valueWithoutApp: true,
      competition: true,
      icpFit: false,
      plugNaturalness: false,
    },
    rationale: "test",
    status: "approved",
    createdAt: new Date().toISOString(),
  };
}

describe("COMMUNITY_POST_MODE=manual", () => {
  afterEach(() => {
    resetAppConfigCache();
    delete process.env.COMMUNITY_POST_MODE;
    delete process.env.REDDIT_DRY_RUN;
    delete process.env.REDDIT_DATA_DIR;
  });

  it("executeApproved refuses automated post", async () => {
    const appConfig = mergeConfig({ post: { mode: "manual" } });
    // Ensure getCommunityConfig inside executeApproved sees manual via env
    // (executor calls getCommunityConfig() with process.env only).
    process.env.COMMUNITY_POST_MODE = "manual";
    process.env.REDDIT_DRY_RUN = "true";
    process.env.REDDIT_DATA_DIR = ".data-post-mode-test";

    const cfg = getCommunityConfig(process.env, { appConfig });
    assert.equal(cfg.postMode, "manual");

    const result = await executeApproved(sampleDraft());
    assert.equal(result.ok, false);
    assert.equal(result.transport, "manual");
    assert.match(String(result.error), /COMMUNITY_POST_MODE=manual/);
  });
});
