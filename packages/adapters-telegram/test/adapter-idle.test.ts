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
      // Yield so pollLoop cannot busy-spin the event loop
      async getUpdates() {
        await new Promise((r) => setTimeout(r, 20));
        return [];
      },
      async answerCallbackQuery() {},
      async editMessageReplyMarkup() {},
    },
  };
}

async function waitFor(
  pred: () => boolean,
  ms = 1000,
  step = 10
): Promise<void> {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, step));
  }
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
    await waitFor(() => idleCalls.length === 1);
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
    await waitFor(() => sent.at(-1) === "got help");
    assert.equal(sent.at(-1), "got help");
  });

  it("does not deadlock: idle ops that await present still accept Approve", async () => {
    const { client, sent } = mockClient();
    const adapter = new TelegramFeedbackAdapter({
      botToken: "test",
      allowlistUserId: 42,
      client,
    });

    adapter.setOnIdleMessage(async () => {
      // Simulate ops engage: long run that waits for HITL on this same adapter
      const response = await adapter.present(approvalRequest("from-idle"));
      return `done:${response.action}`;
    });

    // Must return immediately even though idle handler is still running
    await Promise.race([
      adapter.ingestAllowlistedText("engage"),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("ingest blocked on idle ops")), 50)
      ),
    ]);

    await waitFor(() => adapter.hasPendingHitl());
    // Poll loop can take the next update because idle did not block ingest
    await adapter.ingestAllowlistedText("approve");
    await waitFor(() => sent.some((t) => t === "done:proceed"));
    assert.ok(sent.some((t) => t === "done:proceed"));
    await adapter.stop();
  });

  it("after HITL settles, idle ops works again", async () => {
    const { client, sent } = mockClient();
    const idleCalls: string[] = [];
    const adapter = new TelegramFeedbackAdapter({
      botToken: "test",
      allowlistUserId: 42,
      client,
      onIdleMessage: async (text) => {
        idleCalls.push(text);
        return `ops:${text}`;
      },
    });

    const presentPromise = adapter.present(approvalRequest());
    await Promise.resolve();
    await adapter.ingestAllowlistedText("status");
    assert.deepEqual(idleCalls, []);

    await adapter.ingestAllowlistedText("approve");
    await presentPromise;
    assert.equal(adapter.hasPendingHitl(), false);

    await adapter.ingestAllowlistedText("status");
    await waitFor(() => idleCalls.length === 1);
    assert.deepEqual(idleCalls, ["status"]);
    assert.equal(sent.at(-1), "ops:status");
    await adapter.stop();
  });

  it("multiple pending HITL cards do not route unmatched text to ops", async () => {
    const { client, sent } = mockClient();
    let idleCalls = 0;
    const adapter = new TelegramFeedbackAdapter({
      botToken: "test",
      allowlistUserId: 42,
      client,
      onIdleMessage: async () => {
        idleCalls += 1;
        return "ops-leak";
      },
    });

    const p1 = adapter.present(approvalRequest("req-a"));
    const p2 = adapter.present(approvalRequest("req-b"));
    await Promise.resolve();
    assert.equal(adapter.hasPendingHitl(), true);

    await adapter.ingestAllowlistedText("status");
    assert.equal(idleCalls, 0);
    assert.ok(!sent.some((t) => t === "ops-leak"));

    // Settle both so the test can exit cleanly
    await adapter.ingestAllowlistedText("approve", { replyToMessageId: 101 });
    await adapter.ingestAllowlistedText("abort", { replyToMessageId: 102 });
    await Promise.all([p1, p2]);
    await adapter.stop();
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
