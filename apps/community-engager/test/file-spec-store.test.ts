import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createSpecBundle, freezeSpec } from "@relay/protocol";
import { compileEngageFromSlots } from "../src/spec/engage-compiler.js";
import {
  createFileSpecStore,
  FileJsonSpecStore,
} from "@relay/spec-store";

describe("FileJsonSpecStore", () => {
  it("puts and gets Intent+Spec bundles by Spec id", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "relay-spec-store-"));
    try {
      const store = createFileSpecStore(dir);
      const { intent, spec: draft } = compileEngageFromSlots("Persist me", {
        maxJobs: 1,
        dryRun: true,
        adapter: "cli",
      });
      const spec = freezeSpec(draft, { frozenBy: "test" });
      const bundle = createSpecBundle(intent, spec, {
        appId: "community-engager",
      });

      await store.put(bundle);
      const loaded = await store.get(spec.id);
      assert.ok(loaded);
      assert.equal(loaded!.id, spec.id);
      assert.equal(loaded!.spec.status, "frozen");
      assert.equal(loaded!.intent.goal, "Persist me");
      assert.equal(loaded!.appId, "community-engager");

      const byIntent = await store.getByIntentId(intent.id);
      assert.ok(byIntent);
      assert.equal(byIntent!.spec.id, spec.id);

      const listed = await store.list({ appId: "community-engager", limit: 5 });
      assert.equal(listed.length, 1);
      assert.ok(store.path.endsWith("specs.json"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("overwrites on put with same Spec id (version bump)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "relay-spec-store-"));
    try {
      const store = new FileJsonSpecStore({
        filePath: path.join(dir, "specs.json"),
      });
      const { intent, spec: draft } = compileEngageFromSlots("v1", {
        dryRun: true,
      });
      const frozen = freezeSpec(draft, { frozenBy: "test" });
      await store.put(createSpecBundle(intent, frozen));

      const bumped = { ...frozen, version: frozen.version + 1, goal: "v2" };
      await store.put(createSpecBundle(intent, bumped));

      const all = await store.list();
      assert.equal(all.length, 1);
      assert.equal(all[0]!.spec.goal, "v2");
      assert.equal(all[0]!.spec.version, frozen.version + 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
