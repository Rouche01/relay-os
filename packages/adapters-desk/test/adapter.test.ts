import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { FeedbackRequest } from "@relay/protocol";
import { DeskFeedbackAdapter } from "../src/adapter.js";

function sampleRequest(id = "req-1"): FeedbackRequest {
  return {
    id,
    agentId: "agent-1",
    type: "confirmation",
    prompt: "Approve CAPTCHA continue?",
    required: true,
    context: {
      title: "Challenge",
      url: "http://127.0.0.1:6080/vnc.html",
      meta: {
        kind: "interstitial",
        transport: "computer",
        vncUrl: "http://127.0.0.1:6080/vnc.html",
        sessionId: "sess-1",
        engageJobId: "engage:1",
      },
    },
  };
}

describe("DeskFeedbackAdapter", () => {
  const adapter = new DeskFeedbackAdapter({
    host: "127.0.0.1",
    port: 19100,
    token: "test-token",
  });

  after(async () => {
    await adapter.stop();
  });

  it("serves pending and resolves on respond", async () => {
    adapter.start();
    const presented = adapter.present(sampleRequest());

    const unauthorized = await fetch(`${adapter.listenUrl}/v1/pending`);
    assert.equal(unauthorized.status, 401);

    const list = await fetch(`${adapter.listenUrl}/v1/pending`, {
      headers: { Authorization: "Bearer test-token" },
    });
    assert.equal(list.status, 200);
    const listed = (await list.json()) as {
      pending: { id: string }[];
    };
    assert.equal(listed.pending.length, 1);
    assert.equal(listed.pending[0]?.id, "req-1");

    const respond = await fetch(`${adapter.listenUrl}/v1/respond`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestId: "req-1",
        action: "proceed",
        value: true,
      }),
    });
    assert.equal(respond.status, 200);

    const response = await presented;
    assert.equal(response.action, "proceed");
    assert.equal(response.requestId, "req-1");
  });

  it("cancelPresent settles without Desk", async () => {
    adapter.start();
    const presented = adapter.present(sampleRequest("req-2"));
    adapter.cancelPresent("req-2", {
      requestId: "req-2",
      agentId: "agent-1",
      action: "proceed",
      value: true,
    });
    const response = await presented;
    assert.equal(response.action, "proceed");
  });
});
