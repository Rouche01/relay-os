import type {
  JsonSchemaLike,
  OpenApiDocument,
  OpenApiParameter,
  OpenApiRequestBody,
  OpenApiSecurityScheme,
} from "./openapi-types.js";

const MAX_REF_DEPTH = 32;

export function resolvePointer(doc: OpenApiDocument, ref: string): unknown {
  if (!ref.startsWith("#/")) {
    throw new Error(
      `Only local $ref pointers are supported (got ${JSON.stringify(ref)})`
    );
  }
  const parts = ref
    .slice(2)
    .split("/")
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  let cur: unknown = doc;
  for (const part of parts) {
    if (!cur || typeof cur !== "object") {
      throw new Error(`Cannot resolve $ref ${ref}`);
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function deref<T extends { $ref?: string }>(
  doc: OpenApiDocument,
  value: T | undefined,
  depth = 0
): T | undefined {
  if (!value) return undefined;
  if (!value.$ref) return value;
  if (depth > MAX_REF_DEPTH) {
    throw new Error(`$ref cycle or too deep: ${value.$ref}`);
  }
  const target = resolvePointer(doc, value.$ref) as T;
  return deref(doc, { ...target, $ref: undefined }, depth + 1);
}

export function resolveParameter(
  doc: OpenApiDocument,
  param: OpenApiParameter
): OpenApiParameter {
  return deref(doc, param) ?? param;
}

export function resolveRequestBody(
  doc: OpenApiDocument,
  body: OpenApiRequestBody | undefined
): OpenApiRequestBody | undefined {
  return deref(doc, body);
}

export function resolveSecurityScheme(
  doc: OpenApiDocument,
  scheme: OpenApiSecurityScheme
): OpenApiSecurityScheme {
  return deref(doc, scheme) ?? scheme;
}

export function resolveSchema(
  doc: OpenApiDocument,
  schema: JsonSchemaLike | undefined,
  depth = 0
): JsonSchemaLike | undefined {
  if (!schema) return undefined;
  if (schema.$ref) {
    if (depth > MAX_REF_DEPTH) {
      throw new Error(`schema $ref cycle or too deep: ${schema.$ref}`);
    }
    const target = resolvePointer(doc, schema.$ref) as JsonSchemaLike;
    return resolveSchema(doc, { ...target, $ref: undefined }, depth + 1);
  }
  if (schema.allOf?.length) {
    // Shallow merge properties for body flattening.
    const merged: JsonSchemaLike = { type: "object", properties: {}, required: [] };
    const required = new Set<string>();
    for (const part of schema.allOf) {
      const r = resolveSchema(doc, part, depth + 1);
      if (!r) continue;
      if (r.properties) {
        merged.properties = { ...merged.properties, ...r.properties };
      }
      for (const name of r.required ?? []) required.add(name);
      if (r.type && !merged.type) merged.type = r.type;
      if (r.description && !merged.description) merged.description = r.description;
    }
    merged.required = [...required];
    return merged;
  }
  return schema;
}
