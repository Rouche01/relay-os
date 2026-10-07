import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ObserveCandidate } from "@relay/engines-browser";
import {
  HeuristicDecisionBackend,
  wrapBackend,
} from "@relay/engines-decide";
import {
  LOGIN_ESCALATE_ID,
  buildLoginControlRequest,
  filterLoginCandidates,
  interpretLoginControlAnswer,
  suggestLoginCandidateId,
} from "../src/login-decide.js";

const loginCandidates: ObserveCandidate[] = [
  {
    id: "role:link:log-in",
    label: "Log In",
    hint: "link",
    role: "link",
    locator: { kind: "role", role: "link", name: "Log In" },
  },
  {
    id: "role:textbox:email-or-username",
    label: "Email or username",
    hint: "textbox",
    role: "textbox",
    locator: { kind: "role", role: "textbox", name: "Email or username" },
  },
  {
    id: "ph:password",
    label: "Password",
    hint: "textbox · type=password",
    role: "textbox",
    locator: { kind: "placeholder", placeholder: "Password" },
  },
  {
    id: "role:button:log-in",
    label: "Log In",
    hint: "button",
    role: "button",
    locator: { kind: "role", role: "button", name: "Log In" },
  },
  {
    id: "role:button:create-account",
    label: "Create account",
    hint: "button",
    role: "button",
    locator: { kind: "role", role: "button", name: "Create account" },
  },
];

describe("filterLoginCandidates / suggestLoginCandidateId", () => {
  it("narrows and suggests the right control per step", () => {
    assert.equal(
      suggestLoginCandidateId(
        "open_login",
        filterLoginCandidates("open_login", loginCandidates)
      ),
      "role:link:log-in"
    );
    assert.equal(
      suggestLoginCandidateId(
        "username",
        filterLoginCandidates("username", loginCandidates)
      ),
      "role:textbox:email-or-username"
    );
    assert.equal(
      suggestLoginCandidateId(
        "password",
        filterLoginCandidates("password", loginCandidates)
      ),
      "ph:password"
    );
    assert.equal(
      suggestLoginCandidateId(
        "submit",
        filterLoginCandidates("submit", loginCandidates)
      ),
      "role:button:log-in"
    );
  });
});

describe("buildLoginControlRequest", () => {
  it("includes escalate sentinel and login meta", () => {
    const filtered = filterLoginCandidates("username", loginCandidates);
    const req = buildLoginControlRequest(
      "username",
      filtered,
      filtered[0]?.id,
      {
        url: "https://www.reddit.com/login/",
        title: "Log in",
        text: "Email or username",
      },
      0.8
    );
    assert.equal(req.meta?.kind, "login");
    assert.equal(req.meta?.step, "username");
    assert.equal(req.policy?.minConfidence, 0.8);
    const choice = req.questions[0];
    assert.ok(choice && choice.kind === "choice");
    assert.ok(choice.candidates.some((c) => c.id === LOGIN_ESCALATE_ID));
    assert.ok(
      choice.candidates.some((c) => c.id === "role:textbox:email-or-username")
    );
  });
});

describe("interpretLoginControlAnswer", () => {
  const observe = {
    url: "https://www.reddit.com/login/",
    title: "Log in",
    text: "form",
    candidates: loginCandidates,
    locatorById: Object.fromEntries(
      loginCandidates.map((c) => [c.id, c.locator])
    ),
  };

  it("acts on a high-confidence username pick", () => {
    const result = interpretLoginControlAnswer(
      {
        answers: {
          control: {
            kind: "choice",
            selectedId: "role:textbox:email-or-username",
            probabilities: { "role:textbox:email-or-username": 0.9 },
          },
        },
        confidence: 0.9,
      },
      "username",
      filterLoginCandidates("username", loginCandidates),
      "role:textbox:email-or-username",
      observe,
      "heuristic",
      0.75
    );
    assert.equal(result.selectedId, "role:textbox:email-or-username");
    assert.equal(result.escalateHitl, false);
  });

  it("escalates when Choice is the escalate sentinel (OTP/CAPTCHA)", () => {
    const result = interpretLoginControlAnswer(
      {
        answers: {
          control: {
            kind: "choice",
            selectedId: LOGIN_ESCALATE_ID,
            probabilities: { [LOGIN_ESCALATE_ID]: 0.95 },
          },
        },
        confidence: 0.95,
      },
      "submit",
      filterLoginCandidates("submit", loginCandidates),
      "role:button:log-in",
      observe,
      "heuristic",
      0.75
    );
    assert.equal(result.selectedId, null);
    assert.equal(result.escalateHitl, true);
  });

  it("escalates below confidence floor", () => {
    const result = interpretLoginControlAnswer(
      {
        answers: {
          control: {
            kind: "choice",
            selectedId: "role:button:log-in",
            probabilities: { "role:button:log-in": 0.4 },
          },
        },
        confidence: 0.4,
      },
      "submit",
      filterLoginCandidates("submit", loginCandidates),
      "role:button:log-in",
      observe,
      "heuristic",
      0.75
    );
    assert.equal(result.escalateHitl, true);
    // Soft suggest kept for semantic fallback actuation
    assert.equal(result.selectedId, "role:button:log-in");
  });
});

describe("DecisionPort offline login Choice", () => {
  it("picks suggested username via heuristic overrides", async () => {
    const port = wrapBackend(new HeuristicDecisionBackend());
    const filtered = filterLoginCandidates("username", loginCandidates);
    const suggested = suggestLoginCandidateId("username", filtered)!;
    const req = buildLoginControlRequest(
      "username",
      filtered,
      suggested,
      {
        url: "https://www.reddit.com/login/",
        title: "Log in",
        text: "Email or username",
      },
      0.65
    );
    req.meta = {
      ...req.meta,
      heuristic: { choiceId: suggested, confidence: 0.9 },
    };
    const answer = await port.decide(req);
    const result = interpretLoginControlAnswer(
      answer,
      "username",
      filtered,
      suggested,
      {
        url: req.state && typeof req.state === "object"
          ? String((req.state as { url?: string }).url ?? "")
          : "",
        title: "Log in",
        text: "form",
        candidates: loginCandidates,
        locatorById: Object.fromEntries(
          loginCandidates.map((c) => [c.id, c.locator])
        ),
      },
      port.backendName,
      0.65
    );
    assert.equal(result.selectedId, suggested);
    assert.equal(result.escalateHitl, false);
  });
});
