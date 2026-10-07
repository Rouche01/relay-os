import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { DecisionRequest } from "@relay/protocol";
import {
  HeuristicDecisionBackend,
  JevDecisionBackend,
  createDecisionPort,
  decisionToFeedbackRequest,
  discoverMinConfidence,
  escalateDecision,
  routeDecision,
  wrapBackend,
} from "../src/index.js";

const saved = {
  DECIDE_BACKEND: process.env.DECIDE_BACKEND,
  DECIDE_DISCOVER_MIN_CONFIDENCE: process.env.DECIDE_DISCOVER_MIN_CONFIDENCE,
  JEV_API_KEY: process.env.JEV_API_KEY,
};

afterEach(() => {
  restoreEnv("DECIDE_BACKEND", saved.DECIDE_BACKEND);
  restoreEnv(
    "DECIDE_DISCOVER_MIN_CONFIDENCE",
    saved.DECIDE_DISCOVER_MIN_CONFIDENCE
  );
  restoreEnv("JEV_API_KEY", saved.JEV_API_KEY);
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function noulFitRequest(
  state: string,
  policy?: DecisionRequest["policy"]
): DecisionRequest {
  return {
    state,
    questions: [
      {
        id: "fit",
        kind: "noul",
        prompt: "Fits our community goal?",
      },
    ],
    policy,
    meta: { kind: "discover" },
  };
}

describe("HeuristicDecisionBackend", () => {
  it("answers noul from keywords and returns high confidence for a clear yes", async () => {
    const backend = new HeuristicDecisionBackend();
    const answer = await backend.decide(
      noulFitRequest("r/fashionadvice fits our styling help goal")
    );
    assert.equal(answer.answers.fit?.kind, "noul");
    if (answer.answers.fit?.kind === "noul") {
      assert.equal(answer.answers.fit.yes, true);
      assert.ok((answer.answers.fit.probability ?? 0) > 0.5);
    }
    assert.ok(answer.confidence >= 0.7);
  });

  it("picks a choice by candidate id in state", async () => {
    const backend = new HeuristicDecisionBackend();
    const answer = await backend.decide({
      state: "page looks like login wall",
      questions: [
        {
          id: "page",
          kind: "choice",
          prompt: "What page class is this?",
          candidates: [
            { id: "feed", label: "Feed" },
            { id: "login", label: "Login" },
            { id: "interstitial", label: "Interstitial" },
          ],
        },
      ],
    });
    assert.equal(answer.answers.page?.kind, "choice");
    if (answer.answers.page?.kind === "choice") {
      assert.equal(answer.answers.page.selectedId, "login");
    }
  });

  it("honors meta.heuristic overrides", async () => {
    const backend = new HeuristicDecisionBackend();
    const answer = await backend.decide({
      ...noulFitRequest("ambiguous text"),
      meta: { heuristic: { noulYes: false, confidence: 0.4 } },
    });
    assert.equal(answer.answers.fit?.kind, "noul");
    if (answer.answers.fit?.kind === "noul") {
      assert.equal(answer.answers.fit.yes, false);
    }
    assert.equal(answer.confidence, 0.4);
  });
});

describe("routeDecision", () => {
  it("escalates below the confidence floor", () => {
    assert.equal(
      routeDecision({ answers: {}, confidence: 0.5 }, { minConfidence: 0.75 }),
      "escalate"
    );
  });

  it("acts at or above the floor when policy is soft", () => {
    assert.equal(
      routeDecision({ answers: {}, confidence: 0.8 }, { minConfidence: 0.75 }),
      "act"
    );
  });

  it("always escalates hard policy bits regardless of confidence", () => {
    assert.equal(
      routeDecision(
        { answers: {}, confidence: 0.99 },
        { promoteToPostable: true }
      ),
      "escalate"
    );
    assert.equal(
      routeDecision(
        { answers: {}, confidence: 0.99 },
        { captchaOrHumanity: true }
      ),
      "escalate"
    );
    assert.equal(
      routeDecision({ answers: {}, confidence: 0.99 }, { networkWrite: true }),
      "escalate"
    );
  });
});

describe("decisionToFeedbackRequest / escalateDecision", () => {
  it("maps escalate to a confirmation FeedbackRequest with decide meta", () => {
    const request = noulFitRequest("sub bio", { minConfidence: 0.9 });
    const answer = {
      answers: {
        fit: { kind: "noul" as const, yes: true, probability: 0.55 },
      },
      confidence: 0.55,
      rationale: "borderline fit",
    };
    const fb = escalateDecision({
      agentId: "community-engager-1",
      request,
      answer,
      id: "decide-test-1",
    });
    assert.equal(fb.id, "decide-test-1");
    assert.equal(fb.agentId, "community-engager-1");
    assert.equal(fb.type, "confirmation");
    assert.equal(fb.required, true);
    assert.match(fb.prompt, /Fits our community goal/);
    assert.equal(fb.context?.meta?.kind, "decide_escalate");
  });

  it("uses choice options when escalating a choice question", () => {
    const fb = decisionToFeedbackRequest({
      agentId: "agent-1",
      id: "c1",
      request: {
        state: "ui",
        questions: [
          {
            id: "page",
            kind: "choice",
            prompt: "Page class?",
            candidates: [
              { id: "feed", label: "feed" },
              { id: "login", label: "login" },
            ],
          },
        ],
      },
      answer: {
        answers: {
          page: { kind: "choice", selectedId: "login" },
        },
        confidence: 0.4,
      },
    });
    assert.equal(fb.type, "choice");
    assert.deepEqual(fb.options, ["feed", "login"]);
  });
});

describe("createDecisionPort", () => {
  it("defaults to heuristic and supports decideAndRoute", async () => {
    delete process.env.DECIDE_BACKEND;
    delete process.env.JEV_API_KEY;
    const port = createDecisionPort();
    assert.equal(port.backendName, "heuristic");
    const { answer, route } = await port.decideAndRoute(
      noulFitRequest("good fit for wardrobe help", {
        minConfidence: 0.7,
      })
    );
    assert.ok(answer.confidence >= 0.7);
    assert.equal(route, "act");
  });

  it("wraps an injected backend", async () => {
    const port = wrapBackend(new HeuristicDecisionBackend());
    const answer = await port.decide(
      noulFitRequest("x", undefined)
    );
    assert.ok(answer.rationale?.includes("heuristic"));
  });

  it("reads DECIDE_DISCOVER_MIN_CONFIDENCE", () => {
    process.env.DECIDE_DISCOVER_MIN_CONFIDENCE = "0.9";
    assert.equal(discoverMinConfidence(), 0.9);
  });
});

describe("JevDecisionBackend mapping", () => {
  it("maps a mocked Jev noul response without hitting the network", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          model: "jev-test",
          answers: { fit: { type: "noul", noul: 0.91 } },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );

    const backend = new JevDecisionBackend({
      apiKey: "test-key",
      fetchImpl,
    });
    const answer = await backend.decide(noulFitRequest("sub bio"));
    assert.equal(answer.answers.fit?.kind, "noul");
    if (answer.answers.fit?.kind === "noul") {
      assert.equal(answer.answers.fit.yes, true);
      assert.equal(answer.answers.fit.probability, 0.91);
    }
    assert.ok(answer.confidence >= 0.91);
    assert.match(answer.rationale ?? "", /jev/);
  });

  it("maps a mocked choice response", async () => {
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        questions: Record<string, { type: string }>;
      };
      assert.equal(body.questions.page?.type, "choice");
      return new Response(
        JSON.stringify({
          model: "jev-test",
          answers: {
            page: {
              type: "choice",
              choice: "interstitial",
              probabilities: {
                feed: 0.05,
                login: 0.1,
                interstitial: 0.85,
              },
              confidence: 0.78,
            },
          },
        }),
        { status: 200 }
      );
    };

    const backend = new JevDecisionBackend({ apiKey: "k", fetchImpl });
    const answer = await backend.decide({
      state: "prove your humanity",
      questions: [
        {
          id: "page",
          kind: "choice",
          prompt: "Page class?",
          candidates: [
            { id: "feed", label: "Feed" },
            { id: "login", label: "Login" },
            { id: "interstitial", label: "Interstitial" },
          ],
        },
      ],
    });
    assert.equal(answer.answers.page?.kind, "choice");
    if (answer.answers.page?.kind === "choice") {
      assert.equal(answer.answers.page.selectedId, "interstitial");
    }
    assert.equal(answer.confidence, 0.78);
  });
});
