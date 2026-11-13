import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createTelegramPhaseProgressGuard,
  telegramDogfoodPhase,
} from "../src/dogfood-phases.js";
import type { PhoneObservation } from "../src/types.js";

function obs(
  elements: Array<{ text?: string; content_desc?: string; ref?: string }>
): PhoneObservation {
  return {
    imageBase64: "x",
    at: "t",
    elements: elements.map((e, i) => ({ ref: e.ref ?? `e${i}`, ...e })),
  };
}

describe("telegramDogfoodPhase", () => {
  it("defaults to find_chat when Amsterdam is absent", () => {
    assert.equal(
      telegramDogfoodPhase(
        obs([{ text: "Chats" }, { text: "Stylens Ops" }, { content_desc: "Search" }])
      ),
      "find_chat"
    );
  });

  it("detects in_amsterdam from title text", () => {
    assert.equal(
      telegramDogfoodPhase(
        obs([{ text: "Amsterdam" }, { text: "hello from the group" }])
      ),
      "in_amsterdam"
    );
  });

  it("detects react when Amsterdam and reaction affordances present", () => {
    assert.equal(
      telegramDogfoodPhase(
        obs([
          { text: "Amsterdam" },
          { content_desc: "Love" },
          { text: "❤" },
        ])
      ),
      "react"
    );
  });
});

describe("createTelegramPhaseProgressGuard", () => {
  it("allows up to budget then returns stuck", () => {
    const guard = createTelegramPhaseProgressGuard({
      budgets: { find_chat: 2, in_amsterdam: 6, react: 5 },
    });
    const o = obs([{ text: "Chats" }]);
    const ctx = (iteration: number) => ({
      iteration,
      observation: o,
      history: [],
    });
    assert.deepEqual(guard(ctx(1)), { ok: true });
    assert.deepEqual(guard(ctx(2)), { ok: true });
    const third = guard(ctx(3));
    assert.equal(third.ok, false);
    if (!third.ok) {
      assert.match(third.error, /find_chat.*3\/2/);
    }
  });

  it("resets counter when phase advances", () => {
    const log: string[] = [];
    const guard = createTelegramPhaseProgressGuard({
      budgets: { find_chat: 2, in_amsterdam: 2, react: 5 },
      onPhase: ({ phase, stepsInPhase, max }) => {
        log.push(`${phase}:${stepsInPhase}/${max}`);
      },
    });
    assert.equal(
      guard({
        iteration: 1,
        observation: obs([{ text: "Chats" }]),
        history: [],
      }).ok,
      true
    );
    assert.equal(
      guard({
        iteration: 2,
        observation: obs([{ text: "Amsterdam" }, { text: "msg" }]),
        history: [],
      }).ok,
      true
    );
    assert.equal(
      guard({
        iteration: 3,
        observation: obs([{ text: "Amsterdam" }, { text: "msg2" }]),
        history: [],
      }).ok,
      true
    );
    const over = guard({
      iteration: 4,
      observation: obs([{ text: "Amsterdam" }, { text: "msg3" }]),
      history: [],
    });
    assert.equal(over.ok, false);
    assert.deepEqual(log, [
      "find_chat:1/2",
      "in_amsterdam:1/2",
      "in_amsterdam:2/2",
      "in_amsterdam:3/2",
    ]);
  });
});
