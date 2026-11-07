/**
 * cs5 dogfood — YouTube / Reddit intents scaffold with args.slot;
 * operator resolves candidates without rewriting Spec law (goal / step ids).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyResolvedSlots } from "@relay/protocol";
import { validateSpecV2 } from "@relay/spec-validator";
import { loadCuratedServices, curatedKnownConnections } from "@relay/services";
import { handleResolveSlot, stubKindFromIntent, stubSpecFromIntent } from "./spec-v2.js";

const YT_INTENT =
  "Every day find YouTube creators with Nigerian audience by niche";
const REDDIT_INTENT = "Help fashion subreddits on Reddit with useful replies";

describe("capability slots dogfood (cs5)", () => {
  const services = loadCuratedServices();
  const known = curatedKnownConnections();

  it("YouTube stub uses youtube.discover via args.slot and validates", () => {
    assert.equal(stubKindFromIntent(YT_INTENT), "youtube");
    const body = stubSpecFromIntent(YT_INTENT, {
      services,
      knownConnections: known,
    });
    const slot = body.slots?.find((s) => s.id === "youtube.discover");
    assert.ok(slot);
    assert.ok(
      (slot!.candidates?.length ?? 0) >= 2,
      "expects alternatives (official blocked + degraded/computer/human)"
    );
    assert.ok(
      slot!.candidates.some((c) => c.status === "blocked" && c.service === "youtube-data")
    );
    assert.ok(slot!.candidates.some((c) => c.binding === "computer"));
    assert.ok(
      slot!.candidates.some(
        (c) => c.status === "degraded" && c.service === "http-fetch"
      )
    );

    const scout = body.steps.find((s) => s.id === "scout");
    assert.ok(scout);
    assert.equal((scout!.args as { slot?: string }).slot, "youtube.discover");
    assert.deepEqual(
      body.steps.map((s) => s.id),
      ["scout", "summarize", "approve"]
    );

    const v = validateSpecV2(body, { services, knownConnections: known });
    assert.equal(v.ok, true, JSON.stringify(v.errors, null, 2));
  });

  it("YouTube: resolve computer → degraded http-fetch without Spec rewrite", () => {
    const body = stubSpecFromIntent(YT_INTENT, {
      services,
      knownConnections: known,
    });
    const slot = body.slots!.find((s) => s.id === "youtube.discover")!;
    const computerIdx = slot.candidates.findIndex((c) => c.binding === "computer");
    const fetchIdx = slot.candidates.findIndex(
      (c) => c.service === "http-fetch" && c.status === "degraded"
    );
    assert.ok(computerIdx >= 0 && fetchIdx >= 0);

    const law = {
      goal: body.goal,
      stepIds: body.steps.map((s) => s.id),
    };

    const toComputer = handleResolveSlot({
      body,
      slotId: "youtube.discover",
      candidateIndex: computerIdx,
    });
    assert.equal(toComputer.ok, true);
    if (!toComputer.ok) return;
    assert.equal(toComputer.degraded, false);

    const appliedComputer = applyResolvedSlots(toComputer.body);
    assert.equal(appliedComputer.ok, true);
    if (!appliedComputer.ok) return;
    assert.equal(appliedComputer.body.goal, law.goal);
    assert.deepEqual(
      appliedComputer.body.steps.map((s) => s.id),
      law.stepIds
    );
    assert.equal(appliedComputer.body.steps[0]!.use, "computer.observe");
    assert.ok(appliedComputer.rewrittenStepIds.includes("scout"));

    const toFetch = handleResolveSlot({
      body: toComputer.body,
      slotId: "youtube.discover",
      candidateIndex: fetchIdx,
    });
    assert.equal(toFetch.ok, true);
    if (!toFetch.ok) return;
    assert.equal(toFetch.degraded, true);

    const appliedFetch = applyResolvedSlots(toFetch.body);
    assert.equal(appliedFetch.ok, true);
    if (!appliedFetch.ok) return;
    assert.equal(appliedFetch.body.goal, law.goal);
    assert.deepEqual(
      appliedFetch.body.steps.map((s) => s.id),
      law.stepIds
    );
    const scoutArgs = appliedFetch.body.steps[0]!.args as Record<string, unknown>;
    assert.equal(appliedFetch.body.steps[0]!.use, "api.request");
    assert.equal(scoutArgs.service, "http-fetch");
    assert.equal(scoutArgs.slot, "youtube.discover");
    assert.ok(appliedFetch.body.services?.includes("http-fetch"));
  });

  it("YouTube: resolve human binding without Spec rewrite", () => {
    const body = stubSpecFromIntent(YT_INTENT, {
      services,
      knownConnections: known,
    });
    const slot = body.slots!.find((s) => s.id === "youtube.discover")!;
    const humanIdx = slot.candidates.findIndex((c) => c.binding === "human");
    assert.ok(humanIdx >= 0);

    const resolved = handleResolveSlot({
      body,
      slotId: "youtube.discover",
      candidateIndex: humanIdx,
    });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;

    const applied = applyResolvedSlots(resolved.body);
    assert.equal(applied.ok, true);
    if (!applied.ok) return;
    assert.equal(applied.body.goal, body.goal);
    assert.equal(applied.body.steps[0]!.use, "human.edit");
    assert.deepEqual(
      applied.body.steps.map((s) => s.id),
      body.steps.map((s) => s.id)
    );
  });

  it("Reddit stub scouts via reddit.read slot; swap public → degraded notify", () => {
    assert.equal(stubKindFromIntent(REDDIT_INTENT), "reddit");
    const body = stubSpecFromIntent(REDDIT_INTENT, {
      services,
      knownConnections: known,
    });
    const slot = body.slots?.find((s) => s.id === "reddit.read");
    assert.ok(slot);
    const scout = body.steps.find((s) => s.id === "scout");
    assert.equal((scout!.args as { slot?: string }).slot, "reddit.read");
    assert.equal(
      (scout!.args as { service?: string }).service,
      "reddit-public"
    );

    const v = validateSpecV2(body, { services, knownConnections: known });
    assert.equal(v.ok, true, JSON.stringify(v.errors, null, 2));

    const publicIdx = slot!.candidates.findIndex(
      (c) => c.service === "reddit-public" && c.binding === "api"
    );
    const notifyIdx = slot!.candidates.findIndex(
      (c) => c.binding === "notify" && c.status === "degraded"
    );
    assert.ok(publicIdx >= 0 && notifyIdx >= 0);

    const lawIds = body.steps.map((s) => s.id);
    const toPublic = handleResolveSlot({
      body,
      slotId: "reddit.read",
      candidateIndex: publicIdx,
    });
    assert.equal(toPublic.ok, true);
    if (!toPublic.ok) return;

    const appliedPublic = applyResolvedSlots(toPublic.body);
    assert.equal(appliedPublic.ok, true);
    if (!appliedPublic.ok) return;
    assert.deepEqual(
      appliedPublic.body.steps.map((s) => s.id),
      lawIds
    );
    assert.equal(
      (appliedPublic.body.steps[0]!.args as { service?: string }).service,
      "reddit-public"
    );

    const toNotify = handleResolveSlot({
      body: toPublic.body,
      slotId: "reddit.read",
      candidateIndex: notifyIdx,
    });
    assert.equal(toNotify.ok, true);
    if (!toNotify.ok) return;
    assert.equal(toNotify.degraded, true);

    const appliedNotify = applyResolvedSlots(toNotify.body);
    assert.equal(appliedNotify.ok, true);
    if (!appliedNotify.ok) return;
    assert.equal(appliedNotify.body.goal, body.goal);
    assert.deepEqual(
      appliedNotify.body.steps.map((s) => s.id),
      lawIds
    );
    assert.equal(
      (appliedNotify.body.steps[0]!.args as { service?: string }).service,
      "reddit-public"
    );
    assert.equal(appliedNotify.body.steps[0]!.use, "api.request");
  });
});
