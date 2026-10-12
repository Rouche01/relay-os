import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { draftReply } from "../src/drafter.js";
import { buildDraftPrompt } from "../src/draft-llm.js";
import {
  applySoftCta,
  applyUtmLinks,
  hasDisallowedIntensity1Link,
  withUtm,
} from "../src/soft-cta.js";
import type { CommunityDraft } from "../src/types.js";

function draft(overrides: Partial<CommunityDraft> = {}): CommunityDraft {
  return {
    id: "reddit-abc",
    platform: "reddit",
    subreddit: "femalefashionadvice",
    threadUrl: "https://www.reddit.com/r/femalefashionadvice/comments/abc",
    threadTitle: "Capsule help",
    opText: "Need a simple system.",
    draftText: "Start with roles you already dress for.",
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
    rationale: "fit",
    status: "proposed",
    createdAt: new Date().toISOString(),
    utmCampaign: "job-1",
    ...overrides,
  };
}

describe("buildDraftPrompt soft-CTA", () => {
  it("documents help-first and intensity 1 = mention / 2 = link", () => {
    const prompt = buildDraftPrompt(draft(), undefined, {
      lpBaseUrl: "https://gostylens.app/lp",
    });
    assert.match(prompt, /Soft-CTA pattern/);
    assert.match(prompt, /mention by name only/);
    assert.match(prompt, /No URL/);
    assert.match(prompt, /https:\/\/gostylens\.app\/lp/);
    assert.match(prompt, /founder disclosure/);
  });
});

describe("applySoftCta", () => {
  it("strips product + LP for intensity 0", () => {
    const out = applySoftCta(
      draft({
        intensity: 0,
        draftText:
          "Audit your closet. GoStylens helps. https://gostylens.app/x",
      }),
      { lpBaseUrl: "https://gostylens.app" }
    );
    assert.equal(out.intensity, 0);
    assert.doesNotMatch(out.draftText, /GoStylens/i);
    assert.doesNotMatch(out.draftText, /gostylens\.app/i);
  });

  it("keeps mention and removes LP URL for intensity 1", () => {
    const out = applySoftCta(
      draft({
        intensity: 1,
        draftText:
          "Audit roles first. GoStylens can help structure that. https://gostylens.app/?x=1",
      }),
      { lpBaseUrl: "https://gostylens.app" }
    );
    assert.equal(out.intensity, 1);
    assert.match(out.draftText, /GoStylens/);
    assert.equal(
      hasDisallowedIntensity1Link(out.draftText, "https://gostylens.app"),
      false
    );
  });

  it("ensures disclosure + tracked LP for intensity 2", () => {
    const out = applySoftCta(
      draft({
        intensity: 2,
        draftText: "Pick three wardrobe roles and fill gaps slowly.",
        utmCampaign: "camp-9",
      }),
      { lpBaseUrl: "https://gostylens.app", campaign: "camp-9" }
    );
    assert.equal(out.intensity, 2);
    assert.match(out.draftText, /disclosure|founder/i);
    assert.match(out.draftText, /gostylens\.app/i);
    // App in medium; community+sub in campaign; token in content.
    assert.match(out.draftText, /utm_medium=community-engager/);
    assert.match(out.draftText, /utm_campaign=community_femalefashionadvice/);
    assert.match(out.draftText, /utm_content=camp-9/);
    assert.match(out.draftText, /utm_source=reddit/);
    assert.equal(out.utmCampaign, "community_femalefashionadvice");
  });

  it("forceIntensity0 overrides plugs", () => {
    const out = applySoftCta(
      draft({
        intensity: 2,
        draftText: "Full disclosure: I built GoStylens. https://gostylens.app",
      }),
      { lpBaseUrl: "https://gostylens.app", forceIntensity0: true }
    );
    assert.equal(out.intensity, 0);
    assert.doesNotMatch(out.draftText, /GoStylens/i);
  });
});

describe("applyUtmLinks", () => {
  it("tags configured LP host, not only gostylens.app hardcoded", () => {
    const text = applyUtmLinks(
      "See https://example.test/app for more",
      "https://example.test/app",
      "job-z"
    );
    assert.match(text, /utm_medium=community-engager/);
    assert.match(text, /utm_campaign=community/);
    assert.match(text, /utm_content=job-z/);
    assert.match(text, /example\.test\/app\?/);
  });

  it("withUtm builds a tracked base URL with app medium + content layers", () => {
    assert.equal(
      withUtm("https://gostylens.app", "abc"),
      "https://gostylens.app?utm_source=reddit&utm_medium=community-engager&utm_campaign=community&utm_content=abc"
    );
  });
});

describe("draftReply soft-CTA stubs", () => {
  it("intensity 1 stub mentions product without a link", async () => {
    delete process.env.GEMINI_API_KEY;
    const outcome = await draftReply(draft({ intensity: 1 }), {
      intensity: 1,
      lpBaseUrl: "https://gostylens.app",
    });
    assert.equal(outcome.draft.intensity, 1);
    assert.match(outcome.draft.draftText, /GoStylens/);
    assert.doesNotMatch(outcome.draft.draftText, /https?:\/\//i);
  });

  it("intensity 2 stub includes disclosure and LP URL", async () => {
    delete process.env.GEMINI_API_KEY;
    const outcome = await draftReply(draft({ intensity: 2 }), {
      intensity: 2,
      lpBaseUrl: "https://gostylens.app/start",
      playbook: {
        rulesSummary: "test",
        plugStyle: "disclose_link",
        megathreadPolicy: "skip",
        maxPlugsPerWeek: 2,
      },
    });
    assert.equal(outcome.draft.intensity, 2);
    assert.match(outcome.draft.draftText, /disclosure|founder/i);
    assert.match(outcome.draft.draftText, /gostylens\.app\/start/);
    assert.match(outcome.draft.draftText, /utm_/);
  });
});
