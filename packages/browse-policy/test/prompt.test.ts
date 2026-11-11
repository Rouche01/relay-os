import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildBrowseSystemPrompt,
  buildBrowseUserPrompt,
} from "../src/prompt.js";

describe("browse prompts", () => {
  it("system prompt includes goal constraints and mix, not a click script", () => {
    const sys = buildBrowseSystemPrompt({
      text: "Open pricing",
      allowedActions: ["click", "scroll"],
      actionMix: { click: 3, scroll: 2 },
    });
    assert.match(sys, /fixed high-level goal/i);
    assert.match(sys, /click, scroll/);
    assert.match(sys, /click=3/);
    assert.doesNotMatch(sys, /click the pricing button at/i);
  });

  it("user prompt includes goal and history", () => {
    const user = buildBrowseUserPrompt({
      goal: { text: "Find docs" },
      observation: { imageBase64: "abc", at: "2020-01-01T00:00:00Z" },
      history: [
        {
          iteration: 1,
          waitedMs: 500,
          observationAt: "2020-01-01T00:00:00Z",
          decision: {
            kind: "act",
            action: { type: "scroll", direction: "down", amount: 3 },
            reason: "look further",
          },
        },
      ],
      iteration: 2,
      maxIterations: 10,
    });
    assert.match(user, /Find docs/);
    assert.match(user, /scroll/);
    assert.match(user, /iteration 2 of 10/);
  });

  it("phone system prompt uses swipe priors and system chrome keys", () => {
    const sys = buildBrowseSystemPrompt({
      text: "Open About phone",
      seatKind: "phone",
      actionMix: { swipe: 3, click: 2, launch: 1 },
    });
    assert.match(sys, /Android phone/i);
    assert.match(sys, /back.*home.*recents/i);
    assert.match(sys, /never desktop chords like ctrl\+l/i);
    assert.match(sys, /swipe=3/);
    assert.match(sys, /action\.ref/);
  });

  it("user prompt includes compact element list when present", () => {
    const user = buildBrowseUserPrompt({
      goal: { text: "Open Settings", seatKind: "phone" },
      observation: {
        imageBase64: "abc",
        at: "2020-01-01T00:00:00Z",
        elements: [
          {
            ref: "e1",
            text: "Settings",
            content_desc: "Settings",
            clickable: true,
          },
        ],
      },
      history: [],
      iteration: 1,
      maxIterations: 5,
    });
    assert.match(user, /ref=e1/);
    assert.match(user, /Settings/);
    assert.match(user, /element list/i);
  });
});
