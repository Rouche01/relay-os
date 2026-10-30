import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  assertConnectionsAvailable,
  collectSpecConnectionRefs,
  connectionResolverFromStore,
  createEnvConnectionStore,
  createFileJsonConnectionStore,
  createKeychainConnectionStore,
  createMemoryConnectionStore,
  FileJsonConnectionStore,
  isSpecHostError,
  resolveSecretRef,
} from "../src/index.js";

describe("resolveSecretRef", () => {
  it("returns literals and env:VAR", () => {
    assert.equal(resolveSecretRef("tok", {}), "tok");
    assert.equal(
      resolveSecretRef("env:GITHUB_TOKEN", { GITHUB_TOKEN: "ghp_x" }),
      "ghp_x"
    );
  });

  it("fails closed on missing env", () => {
    assert.throws(() => resolveSecretRef("env:MISSING", {}));
  });
});

describe("ConnectionStore backends", () => {
  it("memory lists and gets", () => {
    const store = createMemoryConnectionStore({
      "github:default": { type: "bearer", token: "t" },
    });
    assert.deepEqual(store.listIds(), ["github:default"]);
    assert.deepEqual(store.get("github:default"), {
      type: "bearer",
      token: "t",
    });
  });

  it("file store resolves env: refs", () => {
    const store = createFileJsonConnectionStore(
      {
        "github:default": { type: "bearer", token: "env:GH" },
      },
      { env: { GH: "from-env" } }
    );
    const creds = store.get("github:default");
    assert.ok(creds && creds.type === "bearer");
    assert.equal(creds.token, "from-env");
  });

  it("file store from disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "relay-conn-"));
    const path = join(dir, "connections.json");
    writeFileSync(
      path,
      JSON.stringify({
        "reddit:default": { type: "bearer", token: "r1" },
      })
    );
    const fromFile = FileJsonConnectionStore.fromFile(path);
    assert.deepEqual(fromFile.listIds(), ["reddit:default"]);
    assert.deepEqual(fromFile.get("reddit:default"), {
      type: "bearer",
      token: "r1",
    });
  });

  it("env store uses RELAY_CONNECTIONS JSON", async () => {
    const store = createEnvConnectionStore({
      env: {
        RELAY_CONNECTIONS: JSON.stringify({
          "github:default": { type: "bearer", token: "env:GITHUB_TOKEN" },
        }),
        GITHUB_TOKEN: "live",
      },
    });
    assert.deepEqual(await Promise.resolve(store.listIds()), ["github:default"]);
    const creds = await Promise.resolve(store.get("github:default"));
    assert.ok(creds && creds.type === "bearer");
    assert.equal(creds.token, "live");
  });

  it("env store map form", async () => {
    const store = createEnvConnectionStore({
      env: { GH_TOKEN: "mapped" },
      map: {
        "github:default": { type: "bearer", tokenEnv: "GH_TOKEN" },
      },
    });
    const creds = await Promise.resolve(store.get("github:default"));
    assert.ok(creds && creds.type === "bearer");
    assert.equal(creds.token, "mapped");
  });

  it("keychain store with injected reader", () => {
    const store = createKeychainConnectionStore({
      ids: ["github:default"],
      readPassword: () => "kc-token",
    });
    assert.deepEqual(store.get("github:default"), {
      type: "bearer",
      token: "kc-token",
    });
  });
});

describe("assertConnectionsAvailable", () => {
  it("collects top-level and step connection refs", () => {
    assert.deepEqual(
      collectSpecConnectionRefs({
        connections: ["github:default"],
        steps: [
          {
            id: "post",
            use: "api.request",
            args: { connection: "github:default" },
          },
          {
            id: "other",
            use: "api.request",
            args: { connection: "slack:bot" },
          },
        ],
      }),
      ["github:default", "slack:bot"]
    );
  });

  it("throws missing_connection with structured details", async () => {
    const store = createMemoryConnectionStore({
      "github:default": { type: "bearer", token: "t" },
    });
    await assert.rejects(
      () =>
        assertConnectionsAvailable(
          {
            connections: ["github:default", "slack:bot"],
            steps: [],
          },
          store
        ),
      (err: unknown) => {
        assert.ok(isSpecHostError(err));
        if (isSpecHostError(err)) {
          assert.equal(err.code, "missing_connection");
          assert.deepEqual(
            (err.details as { missing: string[] }).missing,
            ["slack:bot"]
          );
        }
        return true;
      }
    );
  });

  it("resolver throws on unknown id at execute time", async () => {
    const store = createMemoryConnectionStore({});
    const resolve = connectionResolverFromStore(store);
    await assert.rejects(
      async () => {
        await resolve("github:default");
      },
      (err: unknown) => {
        assert.ok(isSpecHostError(err));
        if (isSpecHostError(err)) assert.equal(err.code, "missing_connection");
        return true;
      }
    );
  });
});
