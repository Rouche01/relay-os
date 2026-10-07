import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HeuristicDecisionBackend,
  wrapBackend,
} from "@relay/engines-decide";
import {
  PAGE_CLASS_CANDIDATES,
  buildPageClassRequest,
  heuristicToPageClass,
  interpretPageClassAnswer,
  pageClassToDetection,
} from "../src/interstitial-decide.js";
import type { InterstitialDetection } from "../src/reddit/interstitial.js";

const clearFeed: InterstitialDetection = {
  challenged: false,
  title: "reddit.com",
};

const loginWall: InterstitialDetection = {
  challenged: true,
  reason: "login_wall",
  title: "Log in",
};

const humanityWall: InterstitialDetection = {
  challenged: true,
  reason: "humanity_wall",
  title: "Prove your humanity",
};

const captchaWidget: InterstitialDetection = {
  challenged: true,
  reason: "captcha_widget",
  title: "reddit.com: fashion",
};

describe("heuristicToPageClass", () => {
  it("maps detections to page classes", () => {
    assert.equal(heuristicToPageClass(clearFeed), "feed");
    assert.equal(heuristicToPageClass(loginWall), "login");
    assert.equal(heuristicToPageClass(humanityWall), "interstitial");
    assert.equal(heuristicToPageClass(captchaWidget), "interstitial");
    assert.equal(
      heuristicToPageClass({ challenged: true, reason: "rate_limit" }),
      "rate_limit"
    );
    assert.equal(
      heuristicToPageClass({ challenged: true, reason: "unknown" }),
      "unknown"
    );
  });
});

describe("pageClassToDetection", () => {
  it("clears feed and preserves captcha_widget under interstitial", () => {
    assert.equal(pageClassToDetection("feed", clearFeed).challenged, false);
    assert.equal(
      pageClassToDetection("interstitial", captchaWidget).reason,
      "captcha_widget"
    );
    assert.equal(
      pageClassToDetection("interstitial", humanityWall).reason,
      "humanity_wall"
    );
    assert.equal(pageClassToDetection("login", clearFeed).reason, "login_wall");
  });
});

describe("buildPageClassRequest", () => {
  it("asks Choice over page classes with interstitial meta", () => {
    const req = buildPageClassRequest(
      {
        suggestedClass: "feed",
        title: "r/fashion",
        bodyText: "posts",
        hasFeedContent: true,
        hasAuthModal: false,
        onAuthPath: false,
        heuristicChallenged: false,
      },
      0.8
    );
    assert.equal(req.meta?.kind, "interstitial");
    assert.equal(req.policy?.minConfidence, 0.8);
    assert.equal(req.policy?.captchaOrHumanity, false);
    assert.equal(req.policy?.escalateFeedbackType, "confirmation");
    assert.equal(req.questions.length, 1);
    assert.equal(req.questions[0]?.kind, "choice");
    assert.equal(req.questions[0]?.id, "page");
    const choice = req.questions[0];
    assert.ok(choice && choice.kind === "choice");
    assert.equal(choice.candidates.length, PAGE_CLASS_CANDIDATES.length);
  });
});

describe("interpretPageClassAnswer", () => {
  it("acts on high-confidence feed", () => {
    const result = interpretPageClassAnswer(
      {
        answers: {
          page: {
            kind: "choice",
            selectedId: "feed",
            probabilities: { feed: 0.9 },
          },
        },
        confidence: 0.9,
      },
      clearFeed,
      "heuristic",
      0.75
    );
    assert.equal(result.pageClass, "feed");
    assert.equal(result.escalateHitl, false);
    assert.equal(result.detection.challenged, false);
  });

  it("escalates when confidence is below floor", () => {
    const result = interpretPageClassAnswer(
      {
        answers: {
          page: {
            kind: "choice",
            selectedId: "feed",
            probabilities: { feed: 0.5 },
          },
        },
        confidence: 0.5,
      },
      clearFeed,
      "heuristic",
      0.75
    );
    assert.equal(result.pageClass, "unknown");
    assert.equal(result.escalateHitl, true);
    assert.equal(result.detection.challenged, true);
  });

  it("keeps heuristic wall reason when escalate overlaps a real wall", () => {
    const result = interpretPageClassAnswer(
      {
        answers: {
          page: {
            kind: "choice",
            selectedId: "unknown",
            probabilities: { unknown: 0.4 },
          },
        },
        confidence: 0.4,
      },
      loginWall,
      "heuristic",
      0.75
    );
    assert.equal(result.escalateHitl, true);
    assert.equal(result.detection.challenged, true);
    assert.equal(result.detection.reason, "login_wall");
  });

  it("maps login Choice to login_wall detection", () => {
    const result = interpretPageClassAnswer(
      {
        answers: {
          page: {
            kind: "choice",
            selectedId: "login",
            probabilities: { login: 0.88 },
          },
        },
        confidence: 0.88,
      },
      clearFeed,
      "heuristic",
      0.75
    );
    assert.equal(result.pageClass, "login");
    assert.equal(result.detection.reason, "login_wall");
    assert.equal(result.escalateHitl, false);
  });
});

describe("score via DecisionPort (offline)", () => {
  it("picks suggestedClass from state via heuristic backend", async () => {
    const port = wrapBackend(new HeuristicDecisionBackend());
    const snap = {
      suggestedClass: "rate_limit" as const,
      title: "Whoa there",
      bodyText: "you are doing that too much",
      hasFeedContent: false,
      hasAuthModal: false,
      onAuthPath: false,
      heuristicChallenged: true,
      heuristicReason: "rate_limit",
    };
    // Heuristic choice confidence is ~0.7 — use a matching floor so we act.
    const floor = 0.65;
    const req = buildPageClassRequest(snap, floor);
    req.meta = {
      ...req.meta,
      heuristic: { choiceId: "rate_limit", confidence: 0.9 },
    };
    const answer = await port.decide(req);
    const result = interpretPageClassAnswer(
      answer,
      { challenged: true, reason: "rate_limit", title: snap.title },
      port.backendName,
      floor
    );
    assert.equal(result.pageClass, "rate_limit");
    assert.equal(result.detection.reason, "rate_limit");
    assert.equal(result.escalateHitl, false);
  });
});
