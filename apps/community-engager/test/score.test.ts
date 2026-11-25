import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RedditListingPost } from "../src/reddit/client.js";
import { DEFAULT_PLAYBOOK } from "../src/policy/playbook.js";
import {
  COMPETITION_COLD_MAX,
  COMPETITION_MAX_COMMENTS,
  CROWDED_HELP_MIN_TOTAL,
  HELP_COMPETITION_SWEET_MAX,
  PRESENCE_COMPETITION_MAX_COMMENTS,
  PRESENCE_COMPETITION_SWEET_MAX,
  competitionBand,
  isHelpOpportunityActionable,
  scoreCompetition,
  scoreCompetitionSweet,
  scorePresencePost,
  scoreRedditPost,
} from "../src/reddit/scout/score.js";
import {
  ACTIONABLE_SCORE_MIN,
  isActionable,
  isPresenceActionable,
  PRESENCE_ACTIONABLE_MIN,
  PRESENCE_SCORE_MAX,
  presenceScoreTotal,
  SCORE_MAX,
  scoreTotal,
} from "../src/types.js";

function post(overrides: Partial<RedditListingPost> = {}): RedditListingPost {
  return {
    id: "abc",
    name: "t3_abc",
    subreddit: "femalefashionadvice",
    title: "How do I build a work capsule when nothing fits?",
    selftext:
      "I keep buying pieces that do not work together. Looking for a simple system, not brand recs.",
    url: "https://www.reddit.com/r/femalefashionadvice/comments/abc",
    permalink: "https://www.reddit.com/r/femalefashionadvice/comments/abc",
    createdUtc: Math.floor(Date.now() / 1000),
    author: "op",
    numComments: 3,
    ...overrides,
  };
}

describe("competitionBand / scoreCompetitionSweet", () => {
  it("labels unknown / cold / sweet / crowded", () => {
    assert.equal(competitionBand(undefined), "unknown");
    assert.equal(competitionBand(COMPETITION_COLD_MAX), "cold");
    assert.equal(competitionBand(COMPETITION_COLD_MAX + 1), "sweet");
    assert.equal(competitionBand(HELP_COMPETITION_SWEET_MAX), "sweet");
    assert.equal(
      competitionBand(HELP_COMPETITION_SWEET_MAX + 1),
      "crowded"
    );
  });

  it("awards competition in sweet/cold/unknown; crowded only when crowdedOk", () => {
    assert.equal(
      scoreCompetitionSweet({ numComments: undefined }),
      true
    );
    assert.equal(scoreCompetitionSweet({ numComments: 1 }), true);
    assert.equal(scoreCompetitionSweet({ numComments: 18 }), true);
    assert.equal(
      scoreCompetitionSweet({
        numComments: HELP_COMPETITION_SWEET_MAX + 5,
        crowdedOk: false,
      }),
      false
    );
    assert.equal(
      scoreCompetitionSweet({
        numComments: HELP_COMPETITION_SWEET_MAX + 5,
        crowdedOk: true,
      }),
      true
    );
  });

  it("legacy scoreCompetition still uses ≤ max", () => {
    assert.equal(scoreCompetition(post({ numComments: undefined })), true);
    assert.equal(
      scoreCompetition(post({ numComments: COMPETITION_MAX_COMMENTS })),
      true
    );
    assert.equal(
      scoreCompetition(post({ numComments: COMPETITION_MAX_COMMENTS + 1 })),
      false
    );
  });
});

describe("scoreRedditPost richer dimensions", () => {
  it("scores a capsule/system ask as actionable (high /8)", () => {
    const { score, rationale, competitionBand: band } = scoreRedditPost(post());
    assert.equal(score.problemFit, true);
    assert.equal(score.icpFit, true);
    assert.equal(score.competition, true);
    assert.equal(band, "sweet");
    assert.equal(score.plugNaturalness, true);
    assert.ok(scoreTotal(score) >= ACTIONABLE_SCORE_MIN);
    assert.ok(isActionable(score));
    assert.ok(isHelpOpportunityActionable(score, band));
    assert.match(rationale, /ICP fit/);
    assert.match(rationale, /competition=sweet\+/);
    assert.match(rationale, new RegExp(`/${SCORE_MAX}`));
  });

  it("gives crowded ICP threads competition credit", () => {
    const { score, competitionBand: band } = scoreRedditPost(
      post({ numComments: HELP_COMPETITION_SWEET_MAX + 8 })
    );
    assert.equal(band, "crowded");
    assert.equal(score.icpFit, true);
    assert.equal(score.competition, true);
    assert.ok(isHelpOpportunityActionable(score, band));
  });

  it("blocks crowded weak-ICP help unless total is strong", () => {
    const { score, competitionBand: band } = scoreRedditPost(
      post({
        title: "How should I style this blazer for a wedding?",
        selftext: "Any ideas on shoes? Please help with the look.",
        numComments: HELP_COMPETITION_SWEET_MAX + 10,
      })
    );
    assert.equal(band, "crowded");
    assert.equal(score.icpFit, false);
    assert.equal(score.competition, false);
    const total = scoreTotal(score);
    if (total < CROWDED_HELP_MIN_TOTAL) {
      assert.equal(isHelpOpportunityActionable(score, band), false);
    }
  });

  it("respects playbook competitionSweetMax", () => {
    const { competitionBand: band, score } = scoreRedditPost(
      post({ numComments: 12 }),
      { playbook: { ...DEFAULT_PLAYBOOK, competitionSweetMax: 10 } }
    );
    assert.equal(band, "crowded");
    // ICP capsule post still gets competition via crowdedOk
    assert.equal(score.competition, true);
  });

  it("marks haul/flex as weak ICP and unnatural plug", () => {
    const { score } = scoreRedditPost(
      post({
        title: "Rate my thrift haul 🔥",
        selftext: "Just showing off finds, no questions.",
        subreddit: "fashion",
      })
    );
    assert.equal(score.icpFit, false);
    assert.equal(score.plugNaturalness, false);
    assert.equal(score.problemFit, false);
    assert.ok(!isActionable(score));
  });

  it("does not treat a generic how-should ask as ICP without wardrobe language", () => {
    const { score } = scoreRedditPost(
      post({
        title: "How should I style this blazer for a wedding?",
        selftext: "Any ideas on shoes? Please help.",
        numComments: 2,
      })
    );
    assert.equal(score.wantsHelp, true);
    assert.equal(score.icpFit, false);
  });

  it("keeps SCORE_MAX at 8 dimensions", () => {
    assert.equal(SCORE_MAX, 8);
    assert.equal(ACTIONABLE_SCORE_MIN, 5);
    assert.equal(HELP_COMPETITION_SWEET_MAX, 25);
    assert.equal(PRESENCE_COMPETITION_SWEET_MAX, 35);
  });
});

describe("scorePresencePost", () => {
  const presencePb = {
    ...DEFAULT_PLAYBOOK,
    presenceEnabled: true,
  };

  it("scores a fit-check as actionable under presence (not help)", () => {
    const fit = post({
      title: "Fit check — navy trousers + white tee for drinks?",
      selftext: "Too casual? Honest thoughts welcome.",
      url: "https://i.redd.it/abc.jpg",
      isSelf: false,
      numComments: 4,
    });
    const help = scoreRedditPost(fit);
    assert.ok(!isActionable(help.score), "help lane should reject fit-check ICP");

    const { score, rationale } = scorePresencePost(fit, {
      playbook: presencePb,
    });
    assert.equal(score.fashionFit, true);
    assert.equal(score.takeRoom, true);
    assert.equal(score.rulesOk, true);
    assert.equal(score.voiceFit, true);
    assert.ok(presenceScoreTotal(score) >= PRESENCE_ACTIONABLE_MIN);
    assert.ok(isPresenceActionable(score));
    assert.match(rationale, /lane=presence/);
    assert.match(rationale, new RegExp(`/${PRESENCE_SCORE_MAX}`));
  });

  it("rejects when playbook.presenceEnabled is false", () => {
    const fit = post({
      title: "Fit check please",
      selftext: "Does this work for a first date?",
      isSelf: false,
      url: "https://i.redd.it/x.jpg",
    });
    const { score } = scorePresencePost(fit, {
      playbook: { ...DEFAULT_PLAYBOOK, presenceEnabled: false },
    });
    assert.equal(score.rulesOk, false);
    assert.ok(!isPresenceActionable(score));
  });

  it("allows denser threads via presence sweet max + takeRoom", () => {
    const fit = post({
      title: "Rate my outfit for a wedding guest",
      selftext: "Thoughts on the silhouette?",
      isSelf: false,
      url: "https://i.redd.it/y.jpg",
      numComments: HELP_COMPETITION_SWEET_MAX + 3,
    });
    // Help legacy ≤max helper is false past help sweet max without crowdedOk
    assert.equal(scoreCompetition(fit), false);
    assert.equal(
      scoreCompetition(fit, PRESENCE_COMPETITION_MAX_COMMENTS),
      true
    );
    const { score, competitionBand: band } = scorePresencePost(fit, {
      playbook: presencePb,
    });
    assert.equal(band, "sweet");
    assert.equal(score.competition, true);
  });

  it("crowded presence without takeRoom loses competition", () => {
    const flex = post({
      title: "Just showing my thrift haul",
      selftext: "Look at this.",
      isSelf: true,
      url: "https://www.reddit.com/r/OUTFITS/comments/abc",
      numComments: PRESENCE_COMPETITION_SWEET_MAX + 5,
    });
    const { score, competitionBand: band } = scorePresencePost(flex, {
      playbook: presencePb,
    });
    assert.equal(band, "crowded");
    assert.equal(score.takeRoom, false);
    assert.equal(score.competition, false);
  });

  it("blocks megathreads unless playbook allows", () => {
    const mega = post({
      title: "Daily Questions Thread — fashion chat",
      selftext: "Fit check dump here",
    });
    const skipped = scorePresencePost(mega, {
      playbook: {
        ...presencePb,
        megathreadPolicy: "skip",
      },
    });
    assert.equal(skipped.score.voiceFit, false);

    const allowed = scorePresencePost(mega, {
      playbook: {
        ...presencePb,
        megathreadPolicy: "help_only",
      },
    });
    assert.equal(allowed.score.voiceFit, true);
  });

  it("denies silent flex with no invite or visual", () => {
    const flex = post({
      title: "Just showing my thrift haul",
      selftext: "Look at this.",
      isSelf: true,
      url: "https://www.reddit.com/r/OUTFITS/comments/abc",
      numComments: 2,
    });
    const { score } = scorePresencePost(flex, { playbook: presencePb });
    assert.equal(score.takeRoom, false);
  });
});
