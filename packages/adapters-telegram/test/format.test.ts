import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FeedbackRequest } from "@relay/protocol";
import {
  formatFeedbackMessage,
  resolveFeedbackKind,
} from "../src/format.js";

function base(
  partial: Partial<FeedbackRequest> &
    Pick<FeedbackRequest, "type" | "prompt">
): FeedbackRequest {
  return {
    id: "req1",
    agentId: "agent-1",
    required: true,
    ...partial,
  };
}

describe("resolveFeedbackKind", () => {
  it("reads meta.kind", () => {
    assert.equal(
      resolveFeedbackKind(
        base({
          type: "approval",
          prompt: "Approve?",
          context: { meta: { kind: "draft" } },
        })
      ),
      "draft"
    );
    assert.equal(
      resolveFeedbackKind(
        base({
          type: "confirmation",
          prompt: "CAPTCHA",
          context: { meta: { kind: "interstitial" } },
        })
      ),
      "interstitial"
    );
  });

  it("falls back from request type when meta missing", () => {
    assert.equal(
      resolveFeedbackKind(base({ type: "credential", prompt: "creds" })),
      "login"
    );
    assert.equal(
      resolveFeedbackKind(base({ type: "choice", prompt: "pick" })),
      "discover"
    );
  });
});

describe("formatFeedbackMessage", () => {
  it("formats a draft card with subreddit header and edit footer", () => {
    const text = formatFeedbackMessage(
      base({
        type: "approval",
        prompt: "Approve this draft?",
        context: {
          title: "Help with sizing",
          body: "Try going true to size.",
          url: "https://www.reddit.com/r/AusFemaleFashion/comments/1/",
          subjectId: "reddit-abc",
          details: [
            { label: "Subreddit", value: "r/AusFemaleFashion" },
            { label: "Score", value: "4/5" },
            { label: "Intensity", value: "0" },
            { label: "Hint", value: "hidden in footer" },
          ],
          meta: { kind: "draft" },
        },
      })
    );
    assert.match(text, /<b>Draft<\/b> · r\/AusFemaleFashion/);
    assert.match(text, /<b>Thread:<\/b> Help with sizing/);
    assert.match(text, /<b>Reply draft<\/b>/);
    assert.match(text, /Try going true to size/);
    assert.match(text, /edit:/);
    assert.doesNotMatch(text, /hidden in footer/);
    assert.doesNotMatch(text, /<b>Subreddit:<\/b>/);
  });

  it("formats discover with pick-one header and options", () => {
    const text = formatFeedbackMessage(
      base({
        type: "choice",
        prompt: "Promote a discovered subreddit?",
        options: ["r/malehairadvice", "none (skip)"],
        context: {
          title: "Promote a discovered subreddit?",
          body: "r/malehairadvice · fit 8/10",
          details: [{ label: "Candidates", value: "1" }],
          meta: { kind: "discover" },
        },
      })
    );
    assert.match(text, /<b>Discover<\/b> · pick one to promote/);
    assert.match(text, /<b>Pick one<\/b>/);
    assert.match(text, /r\/malehairadvice/);
    assert.match(text, /none \(skip\)/);
    assert.doesNotMatch(text, /edit:/);
  });

  it("formats login credentials without Approve hint in footer", () => {
    const text = formatFeedbackMessage(
      base({
        type: "credential",
        prompt: "Reddit browser session needed",
        context: {
          title: "Reddit session",
          url: "https://www.reddit.com/login/",
          details: [{ label: "Stage", value: "ensure_session" }],
          meta: { kind: "login" },
        },
      })
    );
    assert.match(text, /<b>Login<\/b> · credentials needed/);
    assert.match(text, /username on line 1/);
    assert.doesNotMatch(text, /Approve \/ Abort below/);
  });

  it("formats interstitial challenge with headed-browser footer", () => {
    const text = formatFeedbackMessage(
      base({
        type: "confirmation",
        prompt: "Solve CAPTCHA",
        context: {
          title: "Discover blocked — solve CAPTCHA",
          url: "https://www.reddit.com/",
          details: [
            { label: "Reason", value: "humanity_wall" },
            { label: "Hint", value: "Solve in browser" },
          ],
          meta: { kind: "interstitial" },
        },
      })
    );
    assert.match(text, /<b>Challenge<\/b> · prove humanity/);
    assert.match(text, /headed browser/);
    assert.doesNotMatch(text, /Solve in browser/);
    assert.doesNotMatch(text, /edit:/);
  });

  it("formats otp challenge", () => {
    const text = formatFeedbackMessage(
      base({
        type: "credential",
        prompt: "Enter OTP",
        context: {
          title: "Reddit session",
          meta: { kind: "otp" },
        },
      })
    );
    assert.match(text, /<b>Challenge<\/b> · one-time code/);
    assert.match(text, /code\/secret/);
  });
});
