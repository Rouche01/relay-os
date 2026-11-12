import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPhoneSystemPrompt,
  buildPhoneUserPrompt,
} from "../src/prompt.js";

describe("phone prompts", () => {
  it("system prompt uses Android chrome and swipe priors", () => {
    const sys = buildPhoneSystemPrompt({
      text: "Open About phone",
      actionMix: { swipe: 3, click: 2, launch: 1 },
    });
    assert.match(sys, /Android phone/i);
    assert.match(sys, /back.*home.*recents/i);
    assert.match(sys, /never desktop chords like ctrl\+l/i);
    assert.match(sys, /swipe=3/);
    assert.match(sys, /action\.ref/);
    assert.doesNotMatch(sys, /desktop browser/i);
    assert.doesNotMatch(sys, /pricing/i);
    assert.match(sys, /exact visible title/i);
  });

  it("user prompt includes goal, history, and element list", () => {
    const user = buildPhoneUserPrompt({
      goal: { text: "Open Settings" },
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
      history: [
        {
          iteration: 1,
          waitedMs: 400,
          observationAt: "2020-01-01T00:00:00Z",
          decision: {
            kind: "act",
            action: { type: "swipe", x1: 10, y1: 800, x2: 10, y2: 200 },
          },
        },
      ],
      iteration: 2,
      maxIterations: 8,
    });
    assert.match(user, /Open Settings/);
    assert.match(user, /swipe/);
    assert.match(user, /ref=e1/);
    assert.match(user, /element list/i);
    assert.match(user, /iteration 2 of 8/);
  });
});
