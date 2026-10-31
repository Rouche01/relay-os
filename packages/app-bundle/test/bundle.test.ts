import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { ServiceDescriptor, SpecV2Body } from "@relay/protocol";
import {
  buildRelayAppBundle,
  contentAddressId,
  importRelayAppBundleJson,
  isRelayAppBundleError,
  readRelayAppBundle,
  verifyRelayAppBundle,
  writeRelayAppBundle,
} from "../src/index.js";

const githubLite: ServiceDescriptor = {
  id: "github",
  baseUrl: "https://api.github.com",
  auth: { type: "bearer", connection: true },
  operations: [
    {
      id: "issuesListForRepo",
      method: "GET",
      path: "/repos/{owner}/{repo}/issues",
    },
  ],
};

const body: SpecV2Body = {
  goal: "Weekday triage",
  connections: ["github:default"],
  services: ["github"],
  trigger: { schedule: { cron: "0 9 * * 1-5" } },
  budget: { dryRun: true },
  rules: [
    {
      id: "no_promo_links",
      kind: "hard",
      check: { notMatches: "${draft.text}", pattern: "https?://" },
    },
  ],
  steps: [
    {
      id: "scout",
      use: "api.request",
      args: {
        service: "github",
        operation: "issuesListForRepo",
        connection: "github:default",
        params: { owner: "acme", repo: "widgets" },
      },
    },
    {
      id: "approve",
      use: "human.approve",
      args: { show: "${steps.scout.output}" },
    },
  ],
};

describe("Relay App bundle", () => {
  it("builds content-addressed bundle with descriptors + schedules", () => {
    const bundle = buildRelayAppBundle({
      body,
      services: [githubLite],
      exportedAt: "2026-10-31T00:00:00.000Z",
    });
    assert.equal(bundle.kind, "relay.app.bundle");
    assert.equal(bundle.version, 1);
    assert.ok(bundle.id.startsWith("rapp_"));
    assert.equal(bundle.frozen.status, "frozen");
    assert.equal(bundle.requiredConnections.join(","), "github:default");
    assert.equal(bundle.descriptors.length, 1);
    assert.equal(bundle.descriptors[0]?.id, "github");
    assert.ok(bundle.lowered.manifest.schedules?.length);
    assert.equal(bundle.trigger?.schedule?.cron, "0 9 * * 1-5");
    assert.ok((bundle.evals.cases?.length ?? 0) >= 1);

    const { id: _i, exportedAt: _e, ...payload } = bundle;
    assert.equal(bundle.id, contentAddressId(payload));

    const verified = verifyRelayAppBundle(bundle);
    assert.equal(verified.ok, true);
  });

  it("round-trips export/import and fails closed on tamper", () => {
    const dir = mkdtempSync(join(tmpdir(), "relay-bundle-"));
    try {
      const bundle = buildRelayAppBundle({
        body,
        services: [githubLite],
        exportedAt: "2026-10-31T00:00:00.000Z",
      });
      const path = join(dir, "app.relay.json");
      writeRelayAppBundle(path, bundle);
      const imported = readRelayAppBundle(path);
      assert.equal(imported.id, bundle.id);
      assert.equal(imported.specHash, bundle.specHash);

      const tampered = structuredClone(bundle);
      tampered.body.goal = "tampered";
      try {
        importRelayAppBundleJson(JSON.stringify(tampered));
        assert.fail("expected invalid");
      } catch (err) {
        assert.ok(isRelayAppBundleError(err));
        assert.equal(err.code, "bundle_invalid");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails closed when Spec.services lacks a descriptor", () => {
    try {
      buildRelayAppBundle({ body, services: [] });
      assert.fail("expected missing_descriptors");
    } catch (err) {
      assert.ok(isRelayAppBundleError(err));
      assert.equal(err.code, "missing_descriptors");
    }
  });
});
