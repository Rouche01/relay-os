import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FeedbackRequest } from "@relay/protocol";
import {
  TelegramFeedbackAdapter,
  truncateTelegramText,
} from "../src/adapter.js";

function mockClient() {
  const sent: string[] = [];
  let messageId = 100;
  return {
    sent,
    client: {
      async sendMessage(params: { text: string; chat_id: number }) {
        sent.push(params.text);
        messageId += 1;
        return {
          message_id: messageId,
          chat: { id: params.chat_id },
          date: 0,
        };
      },
      async getUpdates() {
        return [];
      },
      async answerCallbackQuery() {},
      async editMessageReplyMarkup() {},
    },
  };
}

function approvalRequest(id = "req-1"): FeedbackRequest {
  return {
    id,
    agentId: "agent",
    type: "approval",
    prompt: "Approve draft?",
    required: true,
    context: {},
  };
}

describe("TelegramFeedbackAdapter idle ops", () => {
  it("forwards idle allowlisted text to onIdleMessage and replies", async () => {
    const { client, sent } = mockClient();
    const idleCalls: string[] = [];
    const adapter = new TelegramFeedbackAdapter({
      botToken: "test",
      allowlistUserId: 42,
      client,
      onIdleMessage: async (text) => {
        idleCalls.push(text);
        return `ok:${text}`;
      },
    });

    await adapter.ingestAllowlistedText("status");
    assert.deepEqual(idleCalls, ["status"]);
    assert.equal(sent.at(-1), "ok:status");
  });

  it("does not call idle handler while HITL present is pending", async () => {
    const { client, sent } = mockClient();
    let idleCalls = 0;
    const adapter = new TelegramFeedbackAdapter({
      botToken: "test",
      allowlistUserId: 42,
      client,
      onIdleMessage: async () => {
        idleCalls += 1;
        return "should-not-send";
      },
    });

    // present() starts poll loop — use client that returns empty updates
    const presentPromise = adapter.present(approvalRequest());
    // Allow present to register pending (sendMessage already sync in mock)
    await Promise.resolve();
    assert.equal(adapter.hasPendingHitl(), true);

    await adapter.ingestAllowlistedText("status");
    assert.equal(idleCalls, 0);
    // First send was the HITL card; no ops reply
    assert.equal(sent.length, 1);
    assert.ok(!sent.some((t) => t === "should-not-send"));

    // Settle HITL so the promise does not hang the test
    await adapter.ingestAllowlistedText("approve");
    const response = await presentPromise;
    assert.equal(response.action, "proceed");
    await adapter.stop();
  });

  it("setOnIdleMessage can attach handler after construction", async () => {
    const { client, sent } = mockClient();
    const adapter = new TelegramFeedbackAdapter({
      botToken: "test",
      allowlistUserId: 42,
      client,
    });
    await adapter.ingestAllowlistedText("status");
    assert.equal(sent.length, 0);

    adapter.setOnIdleMessage(async (t) => `got ${t}`);
    await adapter.ingestAllowlistedText("help");
    assert.equal(sent.at(-1), "got help");
  });
});

describe("truncateTelegramText", () => {
  it("leaves short text alone", () => {
    assert.equal(truncateTelegramText("hi"), "hi");
  });

  it("truncates long text", () => {
    const long = "x".repeat(5000);
    const out = truncateTelegramText(long, 100);
    assert.ok(out.length <= 100);
    assert.match(out, /truncated/);
  });
});
