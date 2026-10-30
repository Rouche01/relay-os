import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { OpenApiDocument } from "./openapi-types.js";

/** Load OpenAPI JSON or YAML from a local file path. */
export function loadOpenApiFile(path: string): OpenApiDocument {
  const text = readFileSync(path, "utf8");
  return parseOpenApiText(text, path);
}

export function parseOpenApiText(text: string, label = "input"): OpenApiDocument {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(`Empty OpenAPI document (${label})`);
  }
  let doc: unknown;
  try {
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      doc = JSON.parse(trimmed);
    } else {
      doc = parseYaml(trimmed);
    }
  } catch (err) {
    throw new Error(
      `Cannot parse OpenAPI ${label}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error(`OpenAPI ${label} must be an object`);
  }
  return doc as OpenApiDocument;
}
