import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  checkServiceDescriptorShape,
  parseServiceDescriptorYaml,
  serviceOperationIsIrreversible,
} from "@relay/protocol";
import {
  emitServiceDescriptorYaml,
  listOpenApiOperations,
  loadOpenApiFile,
  openApiToServiceDescriptor,
  parseOpenApiText,
} from "../src/index.js";

/** pnpm test cwd = package root. */
const fixturePath = join(
  process.cwd(),
  "fixtures/github-issues.openapi.json"
);

describe("openapi-import", () => {
  it("lists GitHub fixture operations", () => {
    const doc = loadOpenApiFile(fixturePath);
    const rows = listOpenApiOperations(doc);
    assert.deepEqual(
      rows.map((r) => r.operationId),
      ["issuesListForRepo", "issuesCreateComment"]
    );
  });

  it("converts selected ops with bearer auth + irreversible writes", () => {
    const doc = loadOpenApiFile(fixturePath);
    const desc = openApiToServiceDescriptor(doc, {
      id: "github",
      operations: ["issuesListForRepo", "issuesCreateComment"],
    });

    assert.equal(desc.id, "github");
    assert.equal(desc.baseUrl, "https://api.github.com");
    assert.deepEqual(desc.auth, { type: "bearer", connection: true });
    assert.equal(desc.operations.length, 2);

    const list = desc.operations[0]!;
    assert.equal(list.id, "issuesListForRepo");
    assert.equal(list.method, "GET");
    assert.equal(list.irreversible, undefined);
    assert.ok(list.params?.some((p) => p.name === "owner" && p.in === "path"));
    assert.ok(list.params?.some((p) => p.name === "labels" && p.in === "query"));

    const comment = desc.operations[1]!;
    assert.equal(comment.id, "issuesCreateComment");
    assert.equal(comment.method, "POST");
    assert.equal(comment.irreversible, true);
    assert.equal(serviceOperationIsIrreversible(comment), true);
    const body = comment.params?.find((p) => p.name === "body" && p.in === "body");
    assert.ok(body);
    assert.equal(body?.required, true);
    assert.equal(body?.type, "string");

    const shape = checkServiceDescriptorShape(desc);
    assert.equal(shape.ok, true);
  });

  it("emits YAML that parseServiceDescriptorYaml accepts", () => {
    const doc = loadOpenApiFile(fixturePath);
    const desc = openApiToServiceDescriptor(doc, {
      id: "github",
      operations: ["issuesListForRepo", "issuesCreateComment"],
      title: "GitHub REST (issues triage subset)",
    });
    const yaml = emitServiceDescriptorYaml(desc, {
      headerComments: ["test"],
    });
    const round = parseServiceDescriptorYaml(yaml);
    assert.equal(round.id, "github");
    assert.equal(round.operations[1]?.irreversible, true);
  });

  it("refuses full import without --all / operations", () => {
    const doc = loadOpenApiFile(fixturePath);
    assert.throws(
      () => openApiToServiceDescriptor(doc, { id: "github" }),
      /Refusing to import entire OpenAPI/
    );
  });

  it("maps apiKey security scheme", () => {
    const doc = parseOpenApiText(
      JSON.stringify({
        openapi: "3.0.3",
        info: { title: "x" },
        servers: [{ url: "https://example.com" }],
        components: {
          securitySchemes: {
            key: { type: "apiKey", in: "header", name: "X-Api-Key" },
          },
        },
        paths: {
          "/ping": {
            get: {
              operationId: "ping",
              responses: { "200": { description: "ok" } },
            },
          },
        },
      })
    );
    const desc = openApiToServiceDescriptor(doc, {
      id: "ex",
      operations: ["ping"],
    });
    assert.deepEqual(desc.auth, {
      type: "apiKey",
      header: "X-Api-Key",
      connection: true,
    });
  });

  it("fixture file stays parseable JSON OpenAPI 3", () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    assert.equal(String(raw.openapi).startsWith("3."), true);
  });
});
