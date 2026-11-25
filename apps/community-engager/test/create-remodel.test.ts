import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createProposalToDraft } from "../src/stages/create/proposal-to-draft.js";
import {
  buildRemodelPrompt,
  stubRemodel,
} from "../src/stages/create/remodel.js";
import {
  CREATE_WINNER_MIN_COMMENTS,
  CREATE_WINNER_MIN_SCORE,
  createCooldownActive,
  passesWinnerGates,
} from "../src/stages/create/winner-scout.js";
import type { RedditListingPost } from "../src/reddit/client.js";
import type { CreateProposal } from "../src/types.js";
import { formatManualPostNotify } from "../src/stages/execute/manual-notify.js";

function winnerPost(
  overrides: Partial<RedditListingPost> = {}
): RedditListingPost {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    id: "w1",
    name: "t3_w1",
    subreddit: "malefashionadvice",
    title: "What I learned rotating three jackets",
    selftext: "Long enough body for a remodel seed.",
    url: "https://www.reddit.com/r/malefashionadvice/comments/w1",
    permalink: "https://www.reddit.com/r/malefashionadvice/comments/w1",
    createdUtc: nowSec - 5 * 86_400,
    author: "op",
    numComments: CREATE_WINNER_MIN_COMMENTS + 2,
    score: CREATE_WINNER_MIN_SCORE + 10,
    ...overrides,
  };
}

describe("create remodel helpers", () => {
  it("buildRemodelPrompt injects create persona (writer POV, no plugs)", () => {
    const prompt = buildRemodelPrompt(
      [
        {
          title: "Fit check: linen shirt",
          body: "Went out…",
          permalink: "https://reddit.com/r/malefashionadvice/comments/x",
        },
      ],
      "malefashionadvice"
    );
    assert.match(prompt, /Persona \(create\.default\)/);
    assert.match(prompt, /first-person/i);
    assert.match(prompt, /No product plugs/);
    assert.match(prompt, /Authorized personal facts: none/);
    assert.match(prompt, /do not copy/i);
    assert.doesNotMatch(prompt, /—/);
  });

  it("buildRemodelPrompt respects persona kill switch", () => {
    const prompt = buildRemodelPrompt(
      [
        {
          title: "Fit check",
          body: "x",
          permalink: "https://reddit.com/r/x/comments/y",
        },
      ],
      "fashion",
      { personaEnabled: false }
    );
    assert.doesNotMatch(prompt, /Persona \(create\.default\)/);
    assert.match(prompt, /Voice: first-person/);
  });

  it("stubRemodel produces original-looking title/body", () => {
    const out = stubRemodel(
      [{ title: "Fit check: linen shirt + wide pants", body: "Went out…" }],
      "malefashionadvice"
    );
    assert.match(out.patternSummary, /First-person/i);
    assert.ok(out.title.length > 8);
    assert.ok(out.body.includes("r/malefashionadvice"));
    assert.ok(!out.body.includes("linen shirt + wide pants"));
  });

  it("passesWinnerGates requires comments + score when known", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    assert.equal(passesWinnerGates(winnerPost(), { nowSec }), true);
    assert.equal(
      passesWinnerGates(
        winnerPost({ score: CREATE_WINNER_MIN_SCORE - 1 }),
        { nowSec }
      ),
      false
    );
    assert.equal(
      passesWinnerGates(
        winnerPost({ numComments: CREATE_WINNER_MIN_COMMENTS - 1 }),
        { nowSec }
      ),
      false
    );
    // Unknown score still ok when comments + age clear (browser listings).
    assert.equal(
      passesWinnerGates(winnerPost({ score: undefined }), { nowSec }),
      true
    );
    assert.equal(
      passesWinnerGates(
        winnerPost({ createdUtc: nowSec - 86_400 }),
        { nowSec }
      ),
      false
    );
    assert.equal(
      passesWinnerGates(
        winnerPost({ createdUtc: nowSec - 86_400 }),
        { nowSec, skipAge: true }
      ),
      true
    );
  });

  it("createCooldownActive gates same-sub create within window", () => {
    const now = Date.parse("2026-11-09T12:00:00Z");
    const entries = [
      {
        postedAt: new Date(now - 2 * 86_400_000).toISOString(),
        kind: "create" as const,
        subreddit: "malefashionadvice",
        intensity: 0 as const,
      },
    ];
    assert.equal(
      createCooldownActive(entries, "malefashionadvice", 7, now),
      true
    );
    assert.equal(createCooldownActive(entries, "streetwear", 7, now), false);
    assert.equal(
      createCooldownActive(entries, "malefashionadvice", 1, now),
      false
    );
  });

  it("createProposalToDraft maps into CommunityDraft for jobs", () => {
    const proposal: CreateProposal = {
      id: "create-test-1",
      kind: "create",
      platform: "reddit",
      subreddit: "malefashionadvice",
      title: "What I learned rotating three jackets",
      body: "Body text here.",
      patternSummary: "lesson + tip",
      sourcePostIds: ["t3_abc"],
      sourcePermalinks: ["https://reddit.com/r/malefashionadvice/comments/abc"],
      status: "proposed",
      createdAt: new Date().toISOString(),
      rationale: "stub",
    };
    const draft = createProposalToDraft(proposal);
    assert.equal(draft.kind, "create");
    assert.equal(draft.threadTitle, proposal.title);
    assert.equal(draft.draftText, proposal.body);
    assert.equal(draft.intensity, 0);
    assert.match(formatManualPostNotify(draft), /Create original post/);
    assert.match(formatManualPostNotify(draft), /Body text here/);
  });
});
