import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkServiceDescriptorShape,
  serviceOperationIsIrreversible,
} from "@relay/protocol";
import {
  CURATED_SERVICE_IDS,
  curatedKnownConnections,
  loadCuratedService,
  loadCuratedServices,
} from "../src/index.js";

describe("@relay/services curated pack", () => {
  it("loads every catalog id with a valid shape", () => {
    const all = loadCuratedServices();
    assert.equal(all.length, CURATED_SERVICE_IDS.length);
    for (const d of all) {
      const checked = checkServiceDescriptorShape(d);
      assert.equal(checked.ok, true, d.id);
      assert.ok(CURATED_SERVICE_IDS.includes(d.id as (typeof CURATED_SERVICE_IDS)[number]));
    }
  });

  it("github + slack writes are irreversible", () => {
    const github = loadCuratedService("github");
    const comment = github.operations.find((o) => o.id === "issuesCreateComment");
    assert.ok(comment);
    assert.equal(serviceOperationIsIrreversible(comment!), true);

    const slack = loadCuratedService("slack");
    const post = slack.operations.find((o) => o.id === "chatPostMessage");
    assert.ok(post);
    assert.equal(serviceOperationIsIrreversible(post!), true);
  });

  it("http-fetch and rss use absolute url path param + auth none", () => {
    const http = loadCuratedService("http-fetch");
    assert.deepEqual(http.auth, { type: "none" });
    assert.equal(http.operations[0]?.path, "{url}");

    const rss = loadCuratedService("rss");
    assert.deepEqual(rss.auth, { type: "none" });
    assert.equal(rss.operations[0]?.id, "fetchFeed");
  });

  it("curatedKnownConnections lists operator refs", () => {
    const refs = curatedKnownConnections();
    assert.ok(refs.includes("reddit:default"));
    assert.ok(refs.includes("github:default"));
    assert.ok(refs.includes("slack:default"));
    assert.ok(refs.includes("notion:default"));
    assert.ok(!refs.includes("http-fetch:default"));
  });
});
