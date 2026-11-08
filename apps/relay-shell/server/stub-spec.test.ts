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

  it("detects github vs youtube vs reddit vs generic", () => {
    assert.equal(
      stubKindFromIntent("Every weekday triage GitHub bugs in acme/widgets"),
      "github"
    );
    assert.equal(
      stubKindFromIntent(
        "Every day find YouTube creators with Nigerian audience by niche"
      ),
      "youtube"
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
      "Every weekday find open issues labeled bug in acme/widgets on GitHub",
      { services, knownConnections: known }
    );
    assert.deepEqual(body.services, ["github"]);
    assert.equal(body.connections?.[0], "github:default");
    assert.ok(body.slots?.some((s) => s.id === "scm.issues"));
    const scm = body.slots?.find((s) => s.id === "scm.issues");
    assert.ok(scm?.resolved, "ASAP pre-resolves preferred github binding");
    const scout = body.steps.find((s) => s.id === "scout");
    const post = body.steps.find((s) => s.id === "post");
    assert.equal((scout?.args as { slot?: string })?.slot, "scm.issues");
    assert.equal((post?.args as { slot?: string })?.slot, "scm.issues");
    const v = validateSpecV2(body, { services, knownConnections: known });
    assert.equal(v.ok, true, JSON.stringify(v.errors, null, 2));
  });

  it("YouTube stub emits youtube.discover slot + args.slot without inventing YouTube API service", () => {
    const body = stubSpecFromIntent(
      "Every day find YouTube creators with Nigerian audience by niche",
      { services, knownConnections: known }
    );
    assert.ok(body.slots?.some((s) => s.id === "youtube.discover"));
    assert.ok(!(body.services ?? []).includes("youtube-data"));
    const scout = body.steps.find((s) => s.id === "scout");
    assert.equal((scout?.args as { slot?: string } | undefined)?.slot, "youtube.discover");
    const v = validateSpecV2(body, { services, knownConnections: known });
    assert.equal(v.ok, true, JSON.stringify(v.errors, null, 2));
  });

  it("generic stub has no invented API services", () => {
    const body = stubSpecFromIntent(
      "Automate my freight TMS without naming a service",
      { services, knownConnections: known }
    );
    assert.deepEqual(body.services ?? [], []);
    assert.ok(body.steps?.every((s) => s.use !== "api.request"));
    const v = validateSpecV2(body, { services, knownConnections: known });
    assert.equal(v.ok, true, JSON.stringify(v.errors, null, 2));
  });
});
