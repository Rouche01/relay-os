/**
 * Service descriptor — OpenAPI-ish subset for Spec v2 `api.request`.
 *
 * Specs reference `service` + `operation` ids. The descriptor is the schema
 * source that catches invented endpoints (validator + engines-api).
 *
 * Authoring format: YAML (see packages/protocol/services/*.yaml).
 * This module is types + shape checks + YAML parse — no network I/O.
 */

import { parse as parseYaml } from "yaml";

export type ServiceHttpMethod =
  | "GET"
  | "HEAD"
  | "OPTIONS"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE";

export const SERVICE_HTTP_METHODS: readonly ServiceHttpMethod[] = [
  "GET",
  "HEAD",
  "OPTIONS",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
] as const;

export type ServiceParamLocation = "path" | "query" | "header" | "body";

export type ServiceParamType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array";

export type ServiceParamDef = {
  name: string;
  in: ServiceParamLocation;
  required?: boolean;
  type?: ServiceParamType;
  description?: string;
};

export type ServiceOperation = {
  /** Stable id referenced by Spec step args.operation. */
  id: string;
  method: ServiceHttpMethod;
  /** Path relative to baseUrl; may include `{param}` placeholders. */
  path: string;
  summary?: string;
  params?: ServiceParamDef[];
  /**
   * Force irreversible even for safe methods (rare).
   * Default: derived from method (GET/HEAD/OPTIONS → none).
   */
  irreversible?: boolean;
};

/**
 * How the api engine authenticates.
 * Secrets never appear here — only connection refs at Spec / runtime.
 */
export type ServiceAuth =
  | { type: "none" }
  | { type: "bearer"; connection: true }
  | { type: "apiKey"; header: string; connection: true };

export type ServiceDescriptor = {
  /** Stable id referenced by Spec step args.service / Spec.services[]. */
  id: string;
  title?: string;
  description?: string;
  baseUrl: string;
  auth?: ServiceAuth;
  operations: ServiceOperation[];
};

const METHOD_SET = new Set<string>(SERVICE_HTTP_METHODS);
const PARAM_IN = new Set<string>(["path", "query", "header", "body"]);
const PARAM_TYPE = new Set<string>([
  "string",
  "number",
  "boolean",
  "object",
  "array",
]);
const SAFE_METHODS = new Set<ServiceHttpMethod>(["GET", "HEAD", "OPTIONS"]);

export function isServiceHttpMethod(value: string): value is ServiceHttpMethod {
  return METHOD_SET.has(value.toUpperCase());
}

/** Method used for side-effect derivation (operation.method). */
export function serviceOperationMethod(
  operation: ServiceOperation
): ServiceHttpMethod {
  return operation.method;
}

/**
 * Effective irreversibility for an operation.
 * GET/HEAD/OPTIONS → false unless `irreversible: true`.
 */
export function serviceOperationIsIrreversible(
  operation: ServiceOperation
): boolean {
  if (operation.irreversible === true) return true;
  return !SAFE_METHODS.has(operation.method);
}

export function getServiceOperation(
  descriptor: ServiceDescriptor,
  operationId: string
): ServiceOperation | undefined {
  return descriptor.operations.find((op) => op.id === operationId);
}

/**
 * Light param check against an operation (required names present).
 * Type coercion / ref resolution belong to the runtime / validator.
 */
export function checkOperationParams(
  operation: ServiceOperation,
  params: Record<string, unknown> | undefined
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const bag = params ?? {};
  for (const p of operation.params ?? []) {
    if (!p.required) continue;
    if (!(p.name in bag) || bag[p.name] === undefined || bag[p.name] === null) {
      errors.push(
        `Missing required param ${JSON.stringify(p.name)} (in: ${p.in})`
      );
    }
  }
  // Unknown params are allowed (forward-compat); validator may tighten later.
  if (errors.length) return { ok: false, errors };
  return { ok: true };
}

/**
 * Shape-check a parsed YAML/JSON document.
 * Does not throw — returns structured errors for the validator repair loop.
 */
export function checkServiceDescriptorShape(
  value: unknown
):
  | { ok: true; descriptor: ServiceDescriptor }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: ["Service descriptor must be an object"] };
  }
  const o = value as Record<string, unknown>;

  if (typeof o.id !== "string" || !o.id.trim()) {
    errors.push("id must be a non-empty string");
  }
  if (typeof o.baseUrl !== "string" || !o.baseUrl.trim()) {
    errors.push("baseUrl must be a non-empty string");
  } else {
    try {
      void new URL(o.baseUrl);
    } catch {
      errors.push(`baseUrl is not a valid URL: ${JSON.stringify(o.baseUrl)}`);
    }
  }

  if (o.auth !== undefined) {
    if (!o.auth || typeof o.auth !== "object" || Array.isArray(o.auth)) {
      errors.push("auth must be an object when present");
    } else {
      const auth = o.auth as Record<string, unknown>;
      if (auth.type === "none") {
        /* ok */
      } else if (auth.type === "bearer") {
        if (auth.connection !== true) {
          errors.push('auth.bearer requires connection: true (no inline secrets)');
        }
      } else if (auth.type === "apiKey") {
        if (typeof auth.header !== "string" || !auth.header.trim()) {
          errors.push("auth.apiKey requires a non-empty header name");
        }
        if (auth.connection !== true) {
          errors.push('auth.apiKey requires connection: true (no inline secrets)');
        }
      } else {
        errors.push(
          `auth.type must be none | bearer | apiKey (got ${JSON.stringify(auth.type)})`
        );
      }
    }
  }

  if (!Array.isArray(o.operations) || o.operations.length === 0) {
    errors.push("operations must be a non-empty array");
  } else {
    const ids = new Set<string>();
    o.operations.forEach((raw, i) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        errors.push(`operations[${i}] must be an object`);
        return;
      }
      const op = raw as Record<string, unknown>;
      if (typeof op.id !== "string" || !op.id.trim()) {
        errors.push(`operations[${i}].id must be a non-empty string`);
      } else if (ids.has(op.id)) {
        errors.push(`duplicate operation id ${JSON.stringify(op.id)}`);
      } else {
        ids.add(op.id);
      }
      if (typeof op.method !== "string" || !isServiceHttpMethod(op.method)) {
        errors.push(
          `operations[${i}].method must be one of ${SERVICE_HTTP_METHODS.join(", ")}`
        );
      } else if (op.method !== op.method.toUpperCase()) {
        // Allow lowercase in YAML; normalize later on parse success path.
      }
      if (typeof op.path !== "string" || !op.path.trim()) {
        errors.push(`operations[${i}].path must be a non-empty string`);
      } else if (
        !op.path.startsWith("/") &&
        !/^\{[a-zA-Z_][\w]*\}$/.test(op.path)
      ) {
        // "/" paths join baseUrl; "{url}" templates allow absolute http(s) targets
        // (http-fetch / rss curated descriptors).
        errors.push(
          `operations[${i}].path must start with / or be a single {param} absolute-URL template`
        );
      }
      if (op.params !== undefined) {
        if (!Array.isArray(op.params)) {
          errors.push(`operations[${i}].params must be an array`);
        } else {
          op.params.forEach((pr, j) => {
            if (!pr || typeof pr !== "object" || Array.isArray(pr)) {
              errors.push(`operations[${i}].params[${j}] must be an object`);
              return;
            }
            const p = pr as Record<string, unknown>;
            if (typeof p.name !== "string" || !p.name.trim()) {
              errors.push(
                `operations[${i}].params[${j}].name must be a non-empty string`
              );
            }
            if (typeof p.in !== "string" || !PARAM_IN.has(p.in)) {
              errors.push(
                `operations[${i}].params[${j}].in must be path|query|header|body`
              );
            }
            if (p.type !== undefined && !PARAM_TYPE.has(String(p.type))) {
              errors.push(
                `operations[${i}].params[${j}].type must be string|number|boolean|object|array`
              );
            }
          });
        }
      }
    });
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, descriptor: normalizeDescriptor(o) };
}

function normalizeDescriptor(o: Record<string, unknown>): ServiceDescriptor {
  const operations = (o.operations as Record<string, unknown>[]).map((op) => {
    const method = String(op.method).toUpperCase() as ServiceHttpMethod;
    const params = Array.isArray(op.params)
      ? (op.params as Record<string, unknown>[]).map((p) => ({
          name: String(p.name),
          in: p.in as ServiceParamLocation,
          required: p.required === true,
          type: p.type as ServiceParamType | undefined,
          description:
            typeof p.description === "string" ? p.description : undefined,
        }))
      : undefined;
    const normalized: ServiceOperation = {
      id: String(op.id),
      method,
      path: String(op.path),
      summary: typeof op.summary === "string" ? op.summary : undefined,
      params,
      irreversible: op.irreversible === true ? true : undefined,
    };
    return normalized;
  });

  let auth: ServiceAuth | undefined;
  if (o.auth && typeof o.auth === "object" && !Array.isArray(o.auth)) {
    const a = o.auth as Record<string, unknown>;
    if (a.type === "none") auth = { type: "none" };
    else if (a.type === "bearer") auth = { type: "bearer", connection: true };
    else if (a.type === "apiKey") {
      auth = {
        type: "apiKey",
        header: String(a.header),
        connection: true,
      };
    }
  }

  return {
    id: String(o.id).trim(),
    title: typeof o.title === "string" ? o.title : undefined,
    description: typeof o.description === "string" ? o.description : undefined,
    baseUrl: String(o.baseUrl).replace(/\/+$/, ""),
    auth,
    operations,
  };
}

/** Parse YAML text into a ServiceDescriptor (fail closed on shape errors). */
export function parseServiceDescriptorYaml(text: string): ServiceDescriptor {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (err) {
    throw new Error(
      `Invalid service descriptor YAML: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const checked = checkServiceDescriptorShape(doc);
  if (!checked.ok) {
    throw new Error(
      `Invalid service descriptor:\n- ${checked.errors.join("\n- ")}`
    );
  }
  return checked.descriptor;
}

/** Parse a plain object (already-loaded JSON/YAML). */
export function parseServiceDescriptor(
  value: unknown
): ServiceDescriptor {
  const checked = checkServiceDescriptorShape(value);
  if (!checked.ok) {
    throw new Error(
      `Invalid service descriptor:\n- ${checked.errors.join("\n- ")}`
    );
  }
  return checked.descriptor;
}

/**
 * Index descriptors by id (first wins). Used by validator / api engine.
 */
export function indexServiceDescriptors(
  descriptors: readonly ServiceDescriptor[]
): Map<string, ServiceDescriptor> {
  const map = new Map<string, ServiceDescriptor>();
  for (const d of descriptors) {
    if (!map.has(d.id)) map.set(d.id, d);
  }
  return map;
}
