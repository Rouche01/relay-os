import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadCuratedServices, curatedKnownConnections } from "@relay/services";
import { handleResolveSlot, stubSpecFromIntent } from "./spec-v2.js";

describe("handleResolveSlot (cs3)", () => {
  const services = loadCuratedServices();
  const known = curatedKnownConnections();

  it("resolves youtube.discover to computer without silent degraded", () => {
    const body = stubSpecFromIntent(
      "Every day find YouTube creators with Nigerian audience by niche",
      { services, knownConnections: known }
    );
    const slot = body.slots?.find((s) => s.id === "youtube.discover");
    assert.ok(slot);
    const computerIdx = slot!.candidates.findIndex((c) => c.binding === "computer");
    assert.ok(computerIdx >= 0);

    const out = handleResolveSlot({
      body,
      slotId: "youtube.discover",
      candidateIndex: computerIdx,
    });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.degraded, false);
    assert.ok(out.body.slots?.[0]?.resolved);
    assert.equal(out.body.slots?.[0]?.preferredCandidateIndex, computerIdx);
    assert.match(out.yaml ?? "", /youtube\.discover/);
  });

  it("refuses blocked candidates", () => {
    const body = stubSpecFromIntent(
      "Every day find YouTube creators with Nigerian audience by niche",
      { services, knownConnections: known }
    );
    const slot = body.slots?.find((s) => s.id === "youtube.discover");
    const blockedIdx = slot!.candidates.findIndex((c) => c.status === "blocked");
    assert.ok(blockedIdx >= 0);
    const out = handleResolveSlot({
      body,
      slotId: "youtube.discover",
      candidateIndex: blockedIdx,
    });
    assert.equal(out.ok, false);
  });

  it("labels degraded when http-fetch is chosen", () => {
    const body = stubSpecFromIntent(
      "Every day find YouTube creators with Nigerian audience by niche",
      { services, knownConnections: known }
    );
    const slot = body.slots?.find((s) => s.id === "youtube.discover");
    const degIdx = slot!.candidates.findIndex(
      (c) => c.status === "degraded" && c.service === "http-fetch"
    );
    assert.ok(degIdx >= 0);
    const out = handleResolveSlot({
      body,
      slotId: "youtube.discover",
      candidateIndex: degIdx,
    });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.degraded, true);
    assert.match(out.note ?? "", /degraded/i);
  });
});
