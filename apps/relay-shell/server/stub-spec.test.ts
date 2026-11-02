import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateSpecV2 } from "@relay/spec-validator";
import { loadCuratedServices, curatedKnownConnections } from "@relay/services";
import {
  stubKindFromIntent,
  stubSpecFromIntent,
} from "./spec-v2.js";

describe("stubSpecFromIntent (catalog-constrained)", () => {
  const services = loadCuratedServices();
  const known = curatedKnownConnections();

  it("detects github vs reddit vs generic", () => {
    assert.equal(
      stubKindFromIntent("Every weekday triage GitHub bugs in acme/widgets"),
      "github"
    );
    assert.equal(
      stubKindFromIntent("Help fashion subreddits on Reddit"),
      "reddit"
    );
    assert.equal(
      stubKindFromIntent("Help a freight broker with portals"),
      "generic"
    );
  });

  it("GitHub triage stub validates against curated catalog", () => {
    const body = stubSpecFromIntent(
      "Every weekday find open issues labeled bug in acme/widgets on GitHub"
    );
    assert.deepEqual(body.services, ["github"]);
    assert.equal(body.connections?.[0], "github:default");
    const v = validateSpecV2(body, { services, knownConnections: known });
    assert.equal(v.ok, true, JSON.stringify(v.errors, null, 2));
  });

  it("generic stub has no invented API services", () => {
    const body = stubSpecFromIntent("Automate my freight TMS without naming a service");
    assert.deepEqual(body.services ?? [], []);
    assert.ok(body.steps?.every((s) => s.use !== "api.request"));
    const v = validateSpecV2(body, { services, knownConnections: known });
    assert.equal(v.ok, true, JSON.stringify(v.errors, null, 2));
  });
});
