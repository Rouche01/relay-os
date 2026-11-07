import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CAPABILITY_VOCAB_SEED,
  checkBindingCandidateShape,
  checkCapabilitySlotShape,
  getCapabilityVocabEntry,
  matchCapabilityVocab,
  preferredLiveOrFirst,
  slotFromVocab,
  slotHasViableCandidate,
  withCandidateStatus,
} from "../src/index.js";

describe("capability-slots (cs1)", () => {
  it("seeds expected vocabulary ids", () => {
    const ids = CAPABILITY_VOCAB_SEED.map((e) => e.id);
    assert.ok(ids.includes("scm.issues"));
    assert.ok(ids.includes("reddit.read"));
    assert.ok(ids.includes("youtube.discover"));
  });

  it("matches intent to vocab entries", () => {
    const yt = matchCapabilityVocab(
      "Every day find YouTube creators with Nigerian audience"
    );
    assert.equal(yt.length, 1);
    assert.equal(yt[0]!.id, "youtube.discover");

    const gh = matchCapabilityVocab(
      "Triage GitHub bugs in acme/widgets and ask before commenting"
    );
    assert.ok(gh.some((e) => e.id === "scm.issues"));

    const reddit = matchCapabilityVocab("Scout fashion subreddits on Reddit");
    assert.ok(reddit.some((e) => e.id === "reddit.read"));
  });

  it("builds unresolved slots with candidates and no silent live pick for blocked youtube", () => {
    const entry = getCapabilityVocabEntry("youtube.discover");
    assert.ok(entry);
    const slot = slotFromVocab(entry!);
    assert.equal(slot.id, "youtube.discover");
    assert.equal(slot.resolved, null);
    assert.ok(slot.candidates.length >= 2);
    assert.ok(slotHasViableCandidate(slot));
    const preferred = slot.candidates[slot.preferredCandidateIndex ?? 0]!;
    assert.notEqual(preferred.status, "live");
    assert.notEqual(preferred.status, "blocked");
  });

  it("prefers live over degraded", () => {
    const idx = preferredLiveOrFirst([
      {
        binding: "api",
        status: "degraded",
        service: "reddit-public",
        rank: 0,
      },
      {
        binding: "api",
        status: "live",
        service: "reddit-oauth",
        rank: 1,
      },
    ]);
    assert.equal(idx, 1);
  });

  it("shape-checks candidates and slots", () => {
    const bad = checkBindingCandidateShape({ binding: "laser", status: "live" });
    assert.equal(bad.ok, false);

    const goodCand = checkBindingCandidateShape(
      withCandidateStatus({
        binding: "api",
        service: "github",
        connection: "github:default",
        defaultStatus: "live",
      })
    );
    assert.equal(goodCand.ok, true);

    const slot = slotFromVocab(getCapabilityVocabEntry("scm.issues")!);
    const checked = checkCapabilitySlotShape(slot);
    assert.equal(checked.ok, true);

    const badSlot = checkCapabilitySlotShape({
      id: "x",
      needs: ["a"],
      candidates: [],
      preferredCandidateIndex: 3,
    });
    assert.equal(badSlot.ok, false);
  });
});
