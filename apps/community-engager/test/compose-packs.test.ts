import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createProtocolEngineStub,
  freezeSpec,
  SPEC_PRIMITIVE_IDS,
} from "@relay/protocol";
import { composeCommunityFromSlots } from "../src/spec/compose-intent.js";
import { communityEngagerPacks } from "../src/spec/packs/community-engager-packs.js";

describe("community engager packs", () => {
  it("registers engage and post_watch packs", () => {
    assert.deepEqual(
      communityEngagerPacks.map((p) => p.id),
      ["community-engager/post_watch", "community-engager/engage"]
    );
  });

  it("engage Spec is protocol-stub runnable for write dry-run", async () => {
    const { spec: draft, packId } = composeCommunityFromSlots("Scout", {
      dryRun: true,
      maxJobs: 1,
    });
    assert.equal(packId, "community-engager/engage");
    const spec = freezeSpec(draft, { frozenBy: "test" });
    for (const id of ["observe", "write", "wait_human", "assert"] as const) {
      assert.ok(
        SPEC_PRIMITIVE_IDS.includes(id),
        `catalog has ${id}`
      );
      assert.ok(
        spec.allowedActions.some((a) => a.id === id),
        `Spec allows ${id}`
      );
    }

    const session = await createProtocolEngineStub().declare(spec);
    const write = await session.invoke({
      actionId: "write",
      primitive: "write",
    });
    assert.equal(write.success, true);
    assert.equal(write.dryRunSimulated, true);
    await session.teardown();
  });
});
