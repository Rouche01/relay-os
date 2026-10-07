import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildObserveCandidates,
  compactPageText,
  observeRefToSemantic,
  type InteractiveNodeSnapshot,
  type ObserveLocatorRef,
} from "../src/observe.js";

describe("compactPageText", () => {
  it("collapses whitespace and trims", () => {
    assert.equal(compactPageText("  hello   \n\n  world  "), "hello world");
  });

  it("caps length with an ellipsis", () => {
    const out = compactPageText("abcdefghij", 5);
    assert.equal(out.length, 5);
    assert.equal(out.endsWith("…"), true);
  });
});

describe("buildObserveCandidates", () => {
  it("builds opaque ids and an id→locator map owned by code", () => {
    const nodes: InteractiveNodeSnapshot[] = [
      {
        tag: "button",
        role: "button",
        name: "Log In",
        placeholder: "",
        type: "button",
        href: "",
        testId: "",
        visible: true,
      },
      {
        tag: "input",
        role: "textbox",
        name: "",
        placeholder: "Username",
        type: "text",
        href: "",
        testId: "login-username",
        visible: true,
      },
      {
        tag: "button",
        role: "button",
        name: "Hidden",
        placeholder: "",
        type: "button",
        href: "",
        testId: "",
        visible: false,
      },
    ];

    const { candidates, locatorById } = buildObserveCandidates(nodes);
    assert.equal(candidates.length, 2);
    assert.ok(candidates.every((c) => c.id && c.label && c.locator));
    assert.equal(Object.keys(locatorById).length, 2);

    const login = candidates.find((c) => c.label === "Log In");
    assert.ok(login);
    assert.equal(login.locator.kind, "role");
    assert.equal(locatorById[login.id], login.locator);

    const user = candidates.find((c) => c.id.startsWith("testid:"));
    assert.ok(user);
    assert.equal(user.locator.kind, "css");
  });

  it("respects maxCandidates", () => {
    const nodes: InteractiveNodeSnapshot[] = Array.from({ length: 10 }, (_, i) => ({
      tag: "button",
      role: "button",
      name: `Btn ${i}`,
      placeholder: "",
      type: "button",
      href: "",
      testId: "",
      visible: true,
    }));
    const { candidates } = buildObserveCandidates(nodes, 3);
    assert.equal(candidates.length, 3);
  });
});

describe("observeRefToSemantic", () => {
  it("maps observe refs for actuation", () => {
    const roleRef: ObserveLocatorRef = {
      kind: "role",
      role: "button",
      name: "Go",
    };
    assert.deepEqual(observeRefToSemantic(roleRef), {
      role: "button",
      name: "Go",
    });
    assert.deepEqual(observeRefToSemantic({ kind: "css", css: "[data-testid=x]" }), {
      css: "[data-testid=x]",
    });
    assert.deepEqual(
      observeRefToSemantic({ kind: "placeholder", placeholder: "Password" }),
      { placeholder: "Password" }
    );
  });
});
