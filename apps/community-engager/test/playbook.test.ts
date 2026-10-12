import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clampIntensityToPlaybook,
  countPlugsThisWeek,
  DEFAULT_PLAYBOOK,
  normalizePlaybook,
  shouldBlockPlugForWeek,
  shouldScoutMegathread,
} from "../src/policy/playbook.js";
import { listingPostsToDrafts } from "../src/reddit/scout/map-drafts.js";
import type { RedditListingPost } from "../src/reddit/client.js";
import { seedPlaybookFor } from "../src/policy/playbook.js";
import { getSubredditPolicy } from "../src/reddit/config.js";

function post(overrides: Partial<RedditListingPost> = {}): RedditListingPost {
  return {
    id: "abc",
    name: "t3_abc",
    subreddit: "femalefashionadvice",
    title: "How do I build a work capsule?",
    selftext:
      "Looking for a simple wardrobe system, not brand recs. Pieces that work together.",
    url: "https://www.reddit.com/r/femalefashionadvice/comments/abc",
    permalink: "https://www.reddit.com/r/femalefashionadvice/comments/abc",
    createdUtc: Math.floor(Date.now() / 1000),
    author: "op",
    numComments: 2,
    ...overrides,
  };
}

describe("normalizePlaybook", () => {
  it("fills defaults and parses aliases", () => {
    const pb = normalizePlaybook({
      plugStyle: "disclose",
      megathreadPolicy: "help",
      maxPlugsPerWeek: 2,
    });
    assert.equal(pb.plugStyle, "disclose_link");
    assert.equal(pb.megathreadPolicy, "help_only");
    assert.equal(pb.maxPlugsPerWeek, 2);
  });
});

describe("clampIntensityToPlaybook", () => {
  it("caps mention playbooks at intensity 1", () => {
    assert.equal(
      clampIntensityToPlaybook(2, { ...DEFAULT_PLAYBOOK, plugStyle: "mention" }),
      1
    );
  });

  it("forces 0 on megathread help_only", () => {
    assert.equal(
      clampIntensityToPlaybook(
        1,
        { ...DEFAULT_PLAYBOOK, megathreadPolicy: "help_only" },
        { isMegathread: true }
      ),
      0
    );
  });

  it("blocks all plugs when plugStyle is none", () => {
    assert.equal(
      clampIntensityToPlaybook(1, { ...DEFAULT_PLAYBOOK, plugStyle: "none" }),
      0
    );
  });
});

describe("shouldBlockPlugForWeek", () => {
  it("blocks when weekly cap already reached", () => {
    const pb = { ...DEFAULT_PLAYBOOK, maxPlugsPerWeek: 1 };
    assert.equal(shouldBlockPlugForWeek(pb, 0), false);
    assert.equal(shouldBlockPlugForWeek(pb, 1), true);
  });

  it("blocks when maxPlugsPerWeek is 0", () => {
    assert.equal(
      shouldBlockPlugForWeek({ ...DEFAULT_PLAYBOOK, maxPlugsPerWeek: 0 }, 0),
      true
    );
  });
});

describe("countPlugsThisWeek", () => {
  it("counts intensity ≥1 for the matching sub", () => {
    const now = Date.parse("2026-10-11T12:00:00Z");
    const n = countPlugsThisWeek(
      [
        {
          postedAt: "2026-10-10T12:00:00Z",
          intensity: 1,
          subreddit: "fashion",
        },
        {
          postedAt: "2026-10-10T12:00:00Z",
          intensity: 0,
          subreddit: "fashion",
        },
        {
          postedAt: "2026-10-10T12:00:00Z",
          intensity: 1,
          subreddit: "other",
        },
      ],
      "fashion",
      now
    );
    assert.equal(n, 1);
  });
});

describe("listingPostsToDrafts + megathread playbook", () => {
  it("skips megathreads when playbook says skip", () => {
    const drafts = listingPostsToDrafts(
      [
        post({
          title: "Daily Questions Thread — Oct 11",
          selftext: "How do I build a capsule wardrobe?",
        }),
      ],
      5,
      {
        playbookFor: () => ({
          ...DEFAULT_PLAYBOOK,
          megathreadPolicy: "skip",
        }),
      }
    );
    assert.equal(drafts.length, 0);
  });

  it("keeps megathreads when playbook is help_only", () => {
    const drafts = listingPostsToDrafts(
      [
        post({
          id: "mega1",
          title: "Daily Questions Thread — Oct 11",
          selftext:
            "How do I build a capsule wardrobe system with pieces that work together?",
        }),
      ],
      5,
      {
        playbookFor: () => ({
          ...DEFAULT_PLAYBOOK,
          megathreadPolicy: "help_only",
          plugStyle: "mention",
        }),
      }
    );
    assert.ok(drafts.length >= 1);
    assert.equal(drafts[0]!.intensity, 0);
    assert.match(drafts[0]!.rationale, /help_only/);
  });
});

describe("seed playbooks", () => {
  it("loads ffa with help_only megathreads", () => {
    const policy = getSubredditPolicy("femalefashionadvice");
    const pb = seedPlaybookFor("femalefashionadvice", policy);
    assert.equal(pb.megathreadPolicy, "help_only");
    assert.equal(pb.plugStyle, "mention");
  });

  it("loads OldFashionedFashion as plug none", () => {
    const policy = getSubredditPolicy("OldFashionedFashion");
    const pb = seedPlaybookFor("OldFashionedFashion", policy);
    assert.equal(pb.plugStyle, "none");
    assert.equal(pb.maxPlugsPerWeek, 0);
  });
});

describe("shouldScoutMegathread", () => {
  it("maps policies", () => {
    assert.equal(shouldScoutMegathread(true, { ...DEFAULT_PLAYBOOK, megathreadPolicy: "skip" }), false);
    assert.equal(shouldScoutMegathread(true, { ...DEFAULT_PLAYBOOK, megathreadPolicy: "help_only" }), true);
    assert.equal(shouldScoutMegathread(false, DEFAULT_PLAYBOOK), true);
  });
});
