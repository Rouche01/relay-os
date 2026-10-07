import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ObserveCandidate } from "@relay/engines-browser";
import {
  HeuristicDecisionBackend,
  wrapBackend,
} from "@relay/engines-decide";
import {
  COMPOSER_ESCALATE_ID,
  buildComposerControlRequest,
  filterComposerCandidates,
  interpretComposerControlAnswer,
  suggestComposerCandidateId,
} from "../src/composer-decide.js";

const composerCandidates: ObserveCandidate[] = [
  {
    id: "role:button:add-a-comment",
    label: "Add a comment",
    hint: "button",
    role: "button",
    locator: { kind: "role", role: "button", name: "Add a comment" },
  },
  {
    id: "role:textbox:add-a-comment",
    label: "Add a comment",
    hint: "textbox · contenteditable",
    role: "textbox",
    locator: { kind: "role", role: "textbox", name: "Add a comment" },
  },
  {
    id: "role:button:comment",
    label: "Comment",
    hint: "button",
    role: "button",
    locator: { kind: "role", role: "button", name: "Comment" },
  },
  {
    id: "role:button:share",
    label: "Share",
    hint: "button",
    role: "button",
    locator: { kind: "role", role: "button", name: "Share" },
  },
];

describe("filterComposerCandidates / suggestComposerCandidateId", () => {
  it("narrows and suggests the right control per step", () => {
    assert.equal(
      suggestComposerCandidateId(
        "open_composer",
        filterComposerCandidates("open_composer", composerCandidates)
      ),
      "role:button:add-a-comment"
    );
    assert.equal(
      suggestComposerCandidateId(
        "editor",
        filterComposerCandidates("editor", composerCandidates)
      ),
      "role:textbox:add-a-comment"
    );
    assert.equal(
      suggestComposerCandidateId(
        "submit",
        filterComposerCandidates("submit", composerCandidates)
      ),
      "role:button:comment"
    );
  });

  it("does not treat Add a comment as the submit button", () => {
    const submitIds = filterComposerCandidates(
      "submit",
      composerCandidates
    ).map((c) => c.id);
    assert.ok(!submitIds.includes("role:button:add-a-comment"));
    assert.ok(submitIds.includes("role:button:comment"));
  });
});

describe("buildComposerControlRequest", () => {
  it("marks submit as postApproveOnly without networkWrite policy", () => {
    const filtered = filterComposerCandidates("submit", composerCandidates);
    const req = buildComposerControlRequest(
      "submit",
      filtered,
      filtered[0]?.id,
      {
        url: "https://www.reddit.com/r/x/comments/1/",
        title: "thread",
        text: "Add a comment",
      },
      0.8
    );
    assert.equal(req.meta?.kind, "composer");
    assert.equal(req.meta?.step, "submit");
    assert.equal(req.meta?.postApproveOnly, true);
    assert.equal(req.policy?.networkWrite, undefined);
    assert.equal(req.policy?.destructive, undefined);
    assert.equal(req.policy?.minConfidence, 0.8);
    const choice = req.questions[0];
    assert.ok(choice && choice.kind === "choice");
    assert.ok(choice.candidates.some((c) => c.id === COMPOSER_ESCALATE_ID));
  });
});

describe("interpretComposerControlAnswer", () => {
  const observe = {
    url: "https://www.reddit.com/r/x/comments/1/",
    title: "thread",
    text: "composer",
    candidates: composerCandidates,
    locatorById: Object.fromEntries(
      composerCandidates.map((c) => [c.id, c.locator])
    ),
  };

  it("acts on a high-confidence editor pick", () => {
    const result = interpretComposerControlAnswer(
      {
        answers: {
          control: {
            kind: "choice",
            selectedId: "role:textbox:add-a-comment",
            probabilities: { "role:textbox:add-a-comment": 0.9 },
          },
        },
        confidence: 0.9,
      },
      "editor",
      filterComposerCandidates("editor", composerCandidates),
      "role:textbox:add-a-comment",
      observe,
      "heuristic",
      0.75
    );
    assert.equal(result.selectedId, "role:textbox:add-a-comment");
    assert.equal(result.escalateHitl, false);
  });

  it("clears selection on escalate sentinel", () => {
    const result = interpretComposerControlAnswer(
      {
        answers: {
          control: {
            kind: "choice",
            selectedId: COMPOSER_ESCALATE_ID,
            probabilities: { [COMPOSER_ESCALATE_ID]: 0.9 },
          },
        },
        confidence: 0.9,
      },
      "submit",
      filterComposerCandidates("submit", composerCandidates),
      "role:button:comment",
      observe,
      "heuristic",
      0.75
    );
    assert.equal(result.selectedId, null);
    assert.equal(result.escalateHitl, true);
  });
});

describe("DecisionPort offline composer Choice", () => {
  it("picks suggested submit via heuristic overrides", async () => {
    const port = wrapBackend(new HeuristicDecisionBackend());
    const filtered = filterComposerCandidates("submit", composerCandidates);
    const suggested = suggestComposerCandidateId("submit", filtered)!;
    const req = buildComposerControlRequest(
      "submit",
      filtered,
      suggested,
      {
        url: "https://www.reddit.com/r/x/comments/1/",
        title: "thread",
        text: "Comment",
      },
      0.65
    );
    req.meta = {
      ...req.meta,
      heuristic: { choiceId: suggested, confidence: 0.9 },
    };
    const answer = await port.decide(req);
    const result = interpretComposerControlAnswer(
      answer,
      "submit",
      filtered,
      suggested,
      {
        url: "https://www.reddit.com/r/x/comments/1/",
        title: "thread",
        text: "composer",
        candidates: composerCandidates,
        locatorById: Object.fromEntries(
          composerCandidates.map((c) => [c.id, c.locator])
        ),
      },
      port.backendName,
      0.65
    );
    assert.equal(result.selectedId, suggested);
    assert.equal(result.escalateHitl, false);
  });
});
