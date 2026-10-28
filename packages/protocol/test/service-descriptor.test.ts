import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  SERVICE_DESCRIPTOR_JSON_SCHEMA,
  SERVICE_DESCRIPTOR_SCHEMA_ID,
  checkOperationParams,
  checkServiceDescriptorShape,
  getServiceOperation,
  indexServiceDescriptors,
  parseServiceDescriptorYaml,
  serviceOperationIsIrreversible,
} from "../src/index.js";

function loadYaml(name: string): string {
  const candidates = [
    join(__dirname, `../../services/${name}`),
    join(__dirname, `../services/${name}`),
  ];
  for (const p of candidates) {
    try {
      return readFileSync(p, "utf8");
    } catch {
      /* try next */
    }
  }
  throw new Error(`service yaml not found: ${name}`);
}

describe("service descriptors", () => {
  it("parses reddit-public.yaml with listNew + getComment", () => {
    const desc = parseServiceDescriptorYaml(loadYaml("reddit-public.yaml"));
    assert.equal(desc.id, "reddit-public");
    assert.equal(desc.auth?.type, "bearer");
    assert.ok(desc.baseUrl.startsWith("https://"));

    const listNew = getServiceOperation(desc, "listNew");
    assert.ok(listNew);
    assert.equal(listNew.method, "GET");
    assert.equal(serviceOperationIsIrreversible(listNew), false);
    assert.equal(
      checkOperationParams(listNew, { subreddit: "malefashionadvice" }).ok,
      true
    );
    assert.equal(checkOperationParams(listNew, {}).ok, false);

    const getComment = getServiceOperation(desc, "getComment");
    assert.ok(getComment);
    assert.match(getComment.path, /\{id\}/);
  });

  it("parses reddit-oauth.yaml comment as irreversible POST", () => {
    const desc = parseServiceDescriptorYaml(loadYaml("reddit-oauth.yaml"));
    assert.equal(desc.id, "reddit-oauth");
    const comment = getServiceOperation(desc, "comment");
    assert.ok(comment);
    assert.equal(comment.method, "POST");
    assert.equal(serviceOperationIsIrreversible(comment), true);
    assert.equal(
      checkOperationParams(comment, {
        thing_id: "t3_abc",
        text: "hello",
      }).ok,
      true
    );
    assert.equal(
      checkOperationParams(comment, { thing_id: "t3_abc" }).ok,
      false
    );
  });

  it("rejects invented operations and bad shapes", () => {
    const desc = parseServiceDescriptorYaml(loadYaml("reddit-public.yaml"));
    assert.equal(getServiceOperation(desc, "inventedEndpoint"), undefined);

    const bad = checkServiceDescriptorShape({
      id: "x",
      baseUrl: "https://example.com",
      operations: [
        { id: "a", method: "GET", path: "/ok" },
        { id: "a", method: "POST", path: "/dup" },
      ],
    });
    assert.equal(bad.ok, false);

    const noSecrets = checkServiceDescriptorShape({
      id: "x",
      baseUrl: "https://example.com",
      auth: { type: "bearer", token: "secret" },
      operations: [{ id: "a", method: "GET", path: "/ok" }],
    });
    assert.equal(noSecrets.ok, false);
  });

  it("indexes descriptors and exports JSON Schema", () => {
    const publicDesc = parseServiceDescriptorYaml(
      loadYaml("reddit-public.yaml")
    );
    const oauthDesc = parseServiceDescriptorYaml(loadYaml("reddit-oauth.yaml"));
    const index = indexServiceDescriptors([publicDesc, oauthDesc]);
    assert.equal(index.get("reddit-public")?.id, "reddit-public");
    assert.equal(index.get("reddit-oauth")?.operations[0]?.id, "comment");

    assert.equal(
      SERVICE_DESCRIPTOR_SCHEMA_ID,
      SERVICE_DESCRIPTOR_JSON_SCHEMA.$id
    );
    assert.deepEqual(SERVICE_DESCRIPTOR_JSON_SCHEMA.required, [
      "id",
      "baseUrl",
      "operations",
    ]);
  });

  it("keeps service-descriptor.schema.json in sync", () => {
    const candidates = [
      join(__dirname, "../../src/service-descriptor.schema.json"),
      join(__dirname, "../src/service-descriptor.schema.json"),
    ];
    let onDisk: unknown;
    for (const p of candidates) {
      try {
        onDisk = JSON.parse(readFileSync(p, "utf8"));
        break;
      } catch {
        /* try next */
      }
    }
    assert.ok(onDisk);
    assert.deepEqual(onDisk, SERVICE_DESCRIPTOR_JSON_SCHEMA);
  });
});
