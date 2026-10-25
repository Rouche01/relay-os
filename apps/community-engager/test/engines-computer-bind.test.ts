import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ComputerEngine } from "@relay/engines-computer";
import type { ContextEngine } from "@relay/context-engine";
import { resetAppConfigCache } from "../src/app-config.js";
import {
  createCommunityEngines,
  createComputerCapabilityEngine,
} from "../src/engines.js";
import { getCommunityConfig } from "../src/reddit/config.js";

function stubMemory(): ContextEngine {
  return {
    name: "stub",
    async health() {
      return true;
    },
    async addFact() {
      return true;
    },
    async addEvent() {
      return [];
    },
    async rememberForPrompt() {
      return "";
    },
  } as unknown as ContextEngine;
}

describe("createCommunityEngines computer bind", () => {
  const prev: Record<string, string | undefined> = {};

  afterEach(() => {
    resetAppConfigCache();
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  function setEnv(key: string, value: string) {
    prev[key] = process.env[key];
    process.env[key] = value;
  }

  it("binds ComputerEngine from gateway config", () => {
    setEnv("COMPUTER_GATEWAY_URL", "http://127.0.0.1:9001");
    setEnv("COMPUTER_API_TOKEN", "tok");
    resetAppConfigCache();
    const engines = createCommunityEngines({ memory: stubMemory() });
    assert.ok(engines.computer);
    assert.equal(engines.computer.type, "computer");
    assert.ok(engines.computer instanceof ComputerEngine);
  });

  it("createComputerCapabilityEngine uses cfg.computer", () => {
    setEnv("COMPUTER_GATEWAY_URL", "http://gw.test:9000");
    resetAppConfigCache();
    const cfg = getCommunityConfig(process.env);
    const engine = createComputerCapabilityEngine(cfg);
    assert.equal(engine.type, "computer");
    assert.equal(cfg.computer.gatewayUrl, "http://gw.test:9000");
  });
});
