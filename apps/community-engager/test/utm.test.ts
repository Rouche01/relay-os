import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { recordAttribution } from "../src/stages/execute/attribution.js";
import {
  buildJobUtm,
  communityCampaign,
  sanitizeUtmToken,
  UTM_APP_ID,
  utmQueryString,
} from "../src/stages/execute/utm.js";
import { withUtm } from "../src/stages/draft/soft-cta.js";

describe("buildJobUtm", () => {
  it("puts app in medium, community+sub in campaign, jobId in content", () => {
    const utm = buildJobUtm({
      jobId: "post:reddit-abc:deadbeef",
      subreddit: "femalefashionadvice",
    });
    assert.equal(utm.source, "reddit");
    assert.equal(utm.medium, UTM_APP_ID);
    assert.equal(utm.medium, "community-engager");
    assert.equal(utm.campaign, "community_femalefashionadvice");
    assert.equal(utm.content, "post_reddit-abc_deadbeef");
    assert.equal(utm.term, "femalefashionadvice");
  });

  it("communityCampaign matches scout draft label shape", () => {
    assert.equal(communityCampaign("fashion"), "community_fashion");
    assert.equal(communityCampaign(), "community");
  });

  it("sanitizeUtmToken strips r/ and unsafe chars", () => {
    assert.equal(sanitizeUtmToken("r/Male Fashion"), "Male_Fashion");
  });
});

describe("withUtm / utmQueryString", () => {
  it("emits all layers on the LP URL", () => {
    const utm = buildJobUtm({ jobId: "job-1", subreddit: "fashion" });
    const url = withUtm("https://gostylens.app", utm);
    assert.match(url, /utm_source=reddit/);
    assert.match(url, /utm_medium=community-engager/);
    assert.match(url, /utm_campaign=community_fashion/);
    assert.match(url, /utm_content=job-1/);
    assert.match(url, /utm_term=fashion/);
    assert.equal(
      utmQueryString(utm),
      "utm_source=reddit&utm_medium=community-engager&utm_campaign=community_fashion&utm_content=job-1&utm_term=fashion"
    );
  });
});

describe("recordAttribution", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("writes a join record under attribution/", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ce-attr-"));
    const utm = buildJobUtm({ jobId: "post:x:1", subreddit: "fashion" });
    await recordAttribution(dir, {
      jobId: "post:x:1",
      draftId: "reddit-x",
      subreddit: "fashion",
      postedUrl: "https://www.reddit.com/r/fashion/comments/1/t/2/",
      intensity: 2,
      utm,
      recordedAt: "2026-10-11T12:00:00.000Z",
    });
    const raw = await readFile(
      path.join(dir, "attribution", "post_x_1.json"),
      "utf8"
    );
    const saved = JSON.parse(raw) as {
      utm: { medium: string; campaign: string; content: string };
    };
    assert.equal(saved.utm.medium, "community-engager");
    assert.equal(saved.utm.campaign, "community_fashion");
    assert.equal(saved.utm.content, "post_x_1");
  });
});
