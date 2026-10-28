import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CATALOG_ENGINE_IDS,
  CATALOG_INVARIANTS,
  ENGINE_CAPABILITY_CATALOG,
  ENGINE_CAPABILITY_IDS,
  capabilitiesForEngine,
  capabilityNeedsHitl,
  catalogEngineToEngineType,
  getCapability,
  isCapabilityUseId,
  parseCapabilityUse,
  resolveCapabilitySideEffect,
} from "../src/index.js";

describe("engine capability catalog", () => {
  it("covers every planned engine and expected verbs", () => {
    assert.deepEqual([...CATALOG_ENGINE_IDS], [
      "llm",
      "api",
      "browser",
      "computer",
      "data",
      "human",
    ]);

    const byEngine = Object.fromEntries(
      CATALOG_ENGINE_IDS.map((e) => [
        e,
        capabilitiesForEngine(e).map((c) => c.verb),
      ])
    );

    assert.deepEqual(byEngine.llm, [
      "generate",
      "classify",
      "extract",
      "judge",
    ]);
    assert.deepEqual(byEngine.api, ["request"]);
    assert.deepEqual(byEngine.browser, [
      "navigate",
      "read",
      "click",
      "type",
      "submit",
    ]);
    assert.deepEqual(byEngine.computer, ["observe", "act"]);
    assert.deepEqual(byEngine.data, ["get", "put", "query", "append"]);
    assert.deepEqual(byEngine.human, ["approve", "edit", "choose"]);
  });

  it("uses unique fully qualified ids", () => {
    const ids = ENGINE_CAPABILITY_CATALOG.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual([...ENGINE_CAPABILITY_IDS], ids);
  });

  it("maps human → EngineType none", () => {
    assert.equal(catalogEngineToEngineType("human"), "none");
    assert.equal(catalogEngineToEngineType("llm"), "llm");
    assert.equal(catalogEngineToEngineType("api"), "api");
  });

  it("parses known and rejects unknown use ids", () => {
    const ok = parseCapabilityUse("api.request");
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.capability.engine, "api");
      assert.equal(ok.capability.verb, "request");
    }

    assert.equal(isCapabilityUseId("llm.generate"), true);
    assert.equal(isCapabilityUseId("llm.invent"), false);

    const badEngine = parseCapabilityUse("magic.wand");
    assert.equal(badEngine.ok, false);
    if (!badEngine.ok) {
      assert.match(badEngine.error, /Unknown catalog engine/);
    }

    const badVerb = parseCapabilityUse("llm.invent");
    assert.equal(badVerb.ok, false);
    if (!badVerb.ok) {
      assert.match(badVerb.error, /Unknown capability/);
    }

    const malformed = parseCapabilityUse("noperiod");
    assert.equal(malformed.ok, false);
  });

  it("resolves api.request side effects from HTTP method", () => {
    const api = getCapability("api.request");
    assert.ok(api);

    assert.equal(
      resolveCapabilitySideEffect(api, { args: { method: "GET" } }),
      "none"
    );
    assert.equal(
      resolveCapabilitySideEffect(api, { args: { method: "get" } }),
      "none"
    );
    assert.equal(
      resolveCapabilitySideEffect(api, { descriptorMethod: "HEAD" }),
      "none"
    );
    assert.equal(
      resolveCapabilitySideEffect(api, { args: { method: "POST" } }),
      "irreversible"
    );
    assert.equal(
      resolveCapabilitySideEffect(api, { args: { method: "DELETE" } }),
      "irreversible"
    );
    // Missing method → fail closed irreversible
    assert.equal(resolveCapabilitySideEffect(api, { args: {} }), "irreversible");
    assert.equal(capabilityNeedsHitl(api, { args: { method: "GET" } }), false);
    assert.equal(capabilityNeedsHitl(api, { args: { method: "POST" } }), true);
  });

  it("keeps fixed irreversible capabilities behind HITL", () => {
    const submit = getCapability("browser.submit");
    const act = getCapability("computer.act");
    const put = getCapability("data.put");
    const approve = getCapability("human.approve");
    assert.ok(submit && act && put && approve);

    assert.equal(resolveCapabilitySideEffect(submit), "irreversible");
    assert.equal(capabilityNeedsHitl(submit), true);
    assert.equal(resolveCapabilitySideEffect(act), "irreversible");
    assert.equal(capabilityNeedsHitl(act), true);
    assert.equal(resolveCapabilitySideEffect(put), "irreversible");
    assert.equal(capabilityNeedsHitl(put), true);
    assert.equal(resolveCapabilitySideEffect(approve), "none");
    assert.equal(capabilityNeedsHitl(approve), false);
  });

  it("requires schemas for required args on core capabilities", () => {
    const generate = getCapability("llm.generate");
    assert.ok(generate);
    assert.equal(generate.args.prompt?.required, true);

    const request = getCapability("api.request");
    assert.ok(request);
    assert.equal(request.args.service?.required, true);
    assert.equal(request.args.operation?.required, true);
  });

  it("exposes named catalog invariants", () => {
    assert.ok(CATALOG_INVARIANTS.inv_no_unbound_capability);
    assert.ok(CATALOG_INVARIANTS.inv_hitl_before_irreversible);
    assert.ok(CATALOG_INVARIANTS.inv_api_method_side_effect);
  });
});
