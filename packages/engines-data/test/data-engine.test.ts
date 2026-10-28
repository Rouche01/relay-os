import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDataEngine, MemoryDataStore } from "../src/index.js";

describe("DataEngine", () => {
  it("put/get/query/append round-trip", async () => {
    const engine = createDataEngine();
    const put = await engine.execute({
      type: "put",
      params: { store: "jobs", key: "j1", value: { status: "open" } },
    });
    assert.equal(put.success, true);

    const got = await engine.execute({
      type: "data.get",
      params: { store: "jobs", key: "j1" },
    });
    assert.equal(got.success, true);
    assert.deepEqual(got.data.value, { status: "open" });

    const queried = await engine.execute({
      type: "query",
      params: { store: "jobs", query: { status: "open" } },
    });
    assert.equal(queried.success, true);
    assert.equal(queried.data.count, 1);

    const appended = await engine.execute({
      type: "append",
      params: { store: "outcomes", value: { ok: true } },
    });
    assert.equal(appended.success, true);

    const log = await engine.execute({
      type: "get",
      params: { store: "outcomes" },
    });
    assert.deepEqual(log.data.value, [{ ok: true }]);
  });

  it("refuse put when allowPut is false", async () => {
    const engine = createDataEngine({ allowPut: false });
    const result = await engine.execute({
      type: "put",
      params: { store: "x", key: "k", value: 1 },
    });
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /allowPut/);
  });

  it("fails closed without store / value", async () => {
    const engine = createDataEngine({ store: new MemoryDataStore() });
    const noStore = await engine.execute({
      type: "append",
      params: { value: 1 },
    });
    assert.equal(noStore.success, false);

    const noValue = await engine.execute({
      type: "append",
      params: { store: "log" },
    });
    assert.equal(noValue.success, false);
  });
});
