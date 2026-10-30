import {
  checkServiceDescriptorShape,
  type ServiceDescriptor,
  type ServiceHttpMethod,
  type ServiceOperation,
  type ServiceParamDef,
  type ServiceParamType,
  SERVICE_HTTP_METHODS,
} from "@relay/protocol";
import { mapAuth, type AuthOverride } from "./auth.js";
import type {
  JsonSchemaLike,
  OpenApiDocument,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiPathItem,
} from "./openapi-types.js";
import {
  resolveParameter,
  resolveRequestBody,
  resolveSchema,
} from "./resolve.js";

const HTTP_VERBS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
] as const;

const SAFE = new Set<ServiceHttpMethod>(["GET", "HEAD", "OPTIONS"]);

export type ListedOperation = {
  operationId: string;
  method: ServiceHttpMethod;
  path: string;
  summary?: string;
  tags: string[];
};

export type ConvertOptions = {
  /** ServiceDescriptor.id (required). */
  id: string;
  title?: string;
  description?: string;
  /** Override servers[0].url */
  baseUrl?: string;
  /** Keep only these operationIds (required unless keepAll). */
  operations?: readonly string[];
  /** When true and operations omitted, import every operation (dangerous for huge OAS). */
  keepAll?: boolean;
  /** Filter by OpenAPI tag (intersection with operations if both set). */
  tags?: readonly string[];
  auth?: AuthOverride;
  /**
   * Emit irreversible: true on write methods (default true).
   * Safe methods stay unmarked unless the OAS somehow needs it (not auto).
   */
  markWritesIrreversible?: boolean;
};

export function listOpenApiOperations(doc: OpenApiDocument): ListedOperation[] {
  assertOpenApi3(doc);
  const out: ListedOperation[] = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    if (!item || typeof item !== "object") continue;
    for (const verb of HTTP_VERBS) {
      const op = item[verb] as OpenApiOperation | undefined;
      if (!op || typeof op !== "object") continue;
      const method = verb.toUpperCase() as ServiceHttpMethod;
      if (!SERVICE_HTTP_METHODS.includes(method)) continue;
      const operationId =
        typeof op.operationId === "string" && op.operationId.trim()
          ? op.operationId.trim()
          : synthesizeOperationId(method, path);
      out.push({
        operationId,
        method,
        path,
        summary:
          typeof op.summary === "string"
            ? op.summary
            : typeof op.description === "string"
              ? op.description
              : undefined,
        tags: Array.isArray(op.tags) ? op.tags.map(String) : [],
      });
    }
  }
  return out;
}

/**
 * Convert an OpenAPI 3 document into a Relay ServiceDescriptor.
 * Fails closed via checkServiceDescriptorShape.
 */
export function openApiToServiceDescriptor(
  doc: OpenApiDocument,
  options: ConvertOptions
): ServiceDescriptor {
  assertOpenApi3(doc);
  const listed = listOpenApiOperations(doc);
  const selected = selectOperations(listed, options);
  if (!selected.length) {
    throw new Error(
      "No operations selected — pass --operations id1,id2 or --all (and optional --tags)"
    );
  }

  const want = new Set(selected.map((s) => s.operationId));
  const operations: ServiceOperation[] = [];
  const seen = new Set<string>();

  for (const [path, rawItem] of Object.entries(doc.paths ?? {})) {
    if (!rawItem || typeof rawItem !== "object") continue;
    const item = rawItem as OpenApiPathItem;
    const pathParams = (item.parameters ?? []).map((p) =>
      resolveParameter(doc, p)
    );

    for (const verb of HTTP_VERBS) {
      const op = item[verb] as OpenApiOperation | undefined;
      if (!op || typeof op !== "object") continue;
      const method = verb.toUpperCase() as ServiceHttpMethod;
      const operationId =
        typeof op.operationId === "string" && op.operationId.trim()
          ? op.operationId.trim()
          : synthesizeOperationId(method, path);
      if (!want.has(operationId)) continue;
      if (seen.has(operationId)) {
        throw new Error(`Duplicate operationId ${JSON.stringify(operationId)}`);
      }
      seen.add(operationId);

      const opParams = (op.parameters ?? []).map((p) =>
        resolveParameter(doc, p)
      );
      const params = mapParameters(doc, [...pathParams, ...opParams], op);
      const markWrites = options.markWritesIrreversible !== false;
      const irreversible =
        markWrites && !SAFE.has(method) ? true : undefined;

      operations.push({
        id: operationId,
        method,
        path: normalizePath(path),
        summary:
          typeof op.summary === "string"
            ? op.summary
            : typeof op.description === "string"
              ? op.description.slice(0, 200)
              : undefined,
        params: params.length ? params : undefined,
        irreversible,
      });
    }
  }

  // Preserve CLI selection order.
  operations.sort(
    (a, b) =>
      selected.findIndex((s) => s.operationId === a.id) -
      selected.findIndex((s) => s.operationId === b.id)
  );

  const baseUrl = resolveBaseUrl(doc, options.baseUrl);
  const auth = mapAuth(doc, options.auth ?? "auto");

  const draft = {
    id: options.id.trim(),
    title: options.title ?? doc.info?.title,
    description: options.description ?? doc.info?.description,
    baseUrl,
    auth,
    operations,
  };

  const checked = checkServiceDescriptorShape(draft);
  if (!checked.ok) {
    throw new Error(
      `Generated descriptor failed shape check:\n- ${checked.errors.join("\n- ")}`
    );
  }
  return checked.descriptor;
}

function selectOperations(
  listed: ListedOperation[],
  options: ConvertOptions
): ListedOperation[] {
  let rows = listed;
  if (options.tags?.length) {
    const tags = new Set(options.tags);
    rows = rows.filter((r) => r.tags.some((t) => tags.has(t)));
  }
  if (options.operations?.length) {
    const want = new Set(options.operations);
    const missing = [...want].filter(
      (id) => !rows.some((r) => r.operationId === id)
    );
    if (missing.length) {
      throw new Error(
        `Unknown operationId(s): ${missing.map((m) => JSON.stringify(m)).join(", ")}. Use --list to see ids.`
      );
    }
    return options.operations
      .map((id) => rows.find((r) => r.operationId === id)!)
      .filter(Boolean);
  }
  if (options.keepAll) return rows;
  throw new Error(
    "Refusing to import entire OpenAPI surface — pass --operations or --all"
  );
}

function mapParameters(
  doc: OpenApiDocument,
  parameters: OpenApiParameter[],
  op: OpenApiOperation
): ServiceParamDef[] {
  const out: ServiceParamDef[] = [];
  const seen = new Set<string>();

  for (const p of parameters) {
    if (!p.name || !p.in) continue;
    const loc = String(p.in).toLowerCase();
    if (loc === "cookie") continue; // unsupported in ServiceDescriptor
    if (!["path", "query", "header"].includes(loc)) continue;
    const key = `${loc}:${p.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const schema = resolveSchema(doc, p.schema);
    out.push({
      name: p.name,
      in: loc as ServiceParamDef["in"],
      required: p.required === true || loc === "path",
      type: schemaType(schema),
      description: p.description ?? schema?.description,
    });
  }

  const body = resolveRequestBody(doc, op.requestBody);
  if (body?.content) {
    const schema =
      resolveSchema(doc, body.content["application/json"]?.schema) ??
      resolveSchema(doc, body.content["application/x-www-form-urlencoded"]?.schema) ??
      resolveSchema(doc, Object.values(body.content)[0]?.schema);

    if (schema?.type === "object" && schema.properties) {
      const required = new Set(schema.required ?? []);
      for (const [name, prop] of Object.entries(schema.properties)) {
        const key = `body:${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const resolved = resolveSchema(doc, prop) ?? prop;
        out.push({
          name,
          in: "body",
          required: body.required === true && required.has(name),
          type: schemaType(resolved),
          description: resolved.description,
        });
      }
    } else if (schema) {
      out.push({
        name: "body",
        in: "body",
        required: body.required === true,
        type: schemaType(schema),
        description: body.description ?? schema.description,
      });
    }
  }

  return out;
}

function schemaType(schema: JsonSchemaLike | undefined): ServiceParamType | undefined {
  if (!schema) return undefined;
  const t = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (
    t === "string" ||
    t === "number" ||
    t === "boolean" ||
    t === "object" ||
    t === "array"
  ) {
    return t;
  }
  if (t === "integer") return "number";
  if (schema.properties) return "object";
  if (schema.items) return "array";
  return "string";
}

function resolveBaseUrl(doc: OpenApiDocument, override?: string): string {
  if (override?.trim()) return override.trim().replace(/\/+$/, "");
  const server = doc.servers?.[0];
  if (!server?.url) {
    throw new Error(
      "OpenAPI has no servers[0].url — pass --base-url explicitly"
    );
  }
  let url = server.url;
  for (const [name, meta] of Object.entries(server.variables ?? {})) {
    const def = meta.default ?? meta.enum?.[0] ?? "";
    url = url.replace(new RegExp(`\\{${name}\\}`, "g"), def);
  }
  if (url.includes("{")) {
    throw new Error(
      `Unresolved server URL variables in ${JSON.stringify(server.url)} — pass --base-url`
    );
  }
  // Relative server URLs need an absolute base.
  if (url.startsWith("/")) {
    throw new Error(
      `Relative servers.url ${JSON.stringify(url)} — pass --base-url`
    );
  }
  return url.replace(/\/+$/, "");
}

function normalizePath(path: string): string {
  if (!path.startsWith("/")) return `/${path}`;
  return path;
}

function synthesizeOperationId(method: string, path: string): string {
  const slug = path
    .replace(/^\//, "")
    .replace(/\{([^}]+)\}/g, "By_$1")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${method.toLowerCase()}_${slug || "root"}`;
}

function assertOpenApi3(doc: OpenApiDocument): void {
  if (doc.swagger) {
    throw new Error(
      `Swagger 2.0 is not supported (got swagger: ${JSON.stringify(doc.swagger)}). Convert to OpenAPI 3 first.`
    );
  }
  const v = String(doc.openapi ?? "");
  if (!v.startsWith("3.")) {
    throw new Error(
      `Expected OpenAPI 3.x (got openapi: ${JSON.stringify(doc.openapi)})`
    );
  }
  if (!doc.paths || typeof doc.paths !== "object") {
    throw new Error("OpenAPI document missing paths");
  }
}
