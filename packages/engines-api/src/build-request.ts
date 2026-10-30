import {
  checkOperationParams,
  getServiceOperation,
  type ServiceDescriptor,
  type ServiceHttpMethod,
  type ServiceOperation,
  type ServiceParamDef,
} from "@relay/protocol";
import type { ApiOperationHint, ApiRequestParams } from "./types.js";

export type BuiltApiRequest = {
  descriptor: ServiceDescriptor;
  operation: ServiceOperation;
  method: ServiceHttpMethod;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
  bodyEncoding: "json" | "form" | undefined;
};

export type BuildApiRequestError = { error: string };

function paramsByLocation(
  operation: ServiceOperation,
  params: Record<string, unknown>
): Record<ServiceParamDef["in"], Record<string, unknown>> {
  const out: Record<ServiceParamDef["in"], Record<string, unknown>> = {
    path: {},
    query: {},
    header: {},
    body: {},
  };
  const defs = operation.params ?? [];
  const known = new Set(defs.map((p) => p.name));

  for (const def of defs) {
    if (params[def.name] !== undefined) {
      out[def.in][def.name] = params[def.name];
    }
  }
  // Undeclared keys → query by default (forward-compat)
  for (const [k, v] of Object.entries(params)) {
    if (!known.has(k)) out.query[k] = v;
  }
  return out;
}

function substitutePath(
  pathTemplate: string,
  pathParams: Record<string, unknown>
): string | { error: string } {
  let path = pathTemplate;
  const needed = [...pathTemplate.matchAll(/\{([a-zA-Z_][\w]*)\}/g)].map(
    (m) => m[1]!
  );
  for (const name of needed) {
    if (pathParams[name] === undefined || pathParams[name] === null) {
      return { error: `Missing path param ${JSON.stringify(name)}` };
    }
    const raw = String(pathParams[name]);
    // Absolute URLs (http-fetch / rss curated descriptors) must not be encoded.
    const encoded = /^https?:\/\//i.test(raw) ? raw : encodeURIComponent(raw);
    path = path.replace(new RegExp(`\\{${name}\\}`, "g"), encoded);
  }
  return path;
}

export function buildApiRequest(
  descriptor: ServiceDescriptor,
  input: ApiRequestParams,
  hint?: ApiOperationHint
): BuiltApiRequest | BuildApiRequestError {
  const operation = getServiceOperation(descriptor, input.operation);
  if (!operation) {
    return {
      error: `Unknown operation ${JSON.stringify(input.operation)} on service ${JSON.stringify(descriptor.id)}`,
    };
  }

  const params = input.params ?? {};
  const paramCheck = checkOperationParams(operation, params);
  if (!paramCheck.ok) {
    return { error: paramCheck.errors.join("; ") };
  }

  const method = (
    input.method ? String(input.method).toUpperCase() : operation.method
  ) as ServiceHttpMethod;
  if (method !== operation.method) {
    return {
      error: `Method ${method} ≠ descriptor ${operation.method} for ${descriptor.id}.${operation.id}`,
    };
  }

  const byLoc = paramsByLocation(operation, params);
  const pathOrErr = substitutePath(operation.path, byLoc.path);
  if (typeof pathOrErr === "object") return pathOrErr;

  const absolute = new URL(
    pathOrErr.startsWith("http")
      ? pathOrErr
      : `${descriptor.baseUrl.replace(/\/+$/, "")}${pathOrErr}`
  );
  for (const [k, v] of Object.entries(byLoc.query)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) absolute.searchParams.append(k, String(item));
    } else {
      absolute.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(byLoc.header)) {
    headers[k] = String(v);
  }

  const encoding =
    input.bodyEncoding ?? hint?.bodyEncoding ?? defaultEncoding(operation);
  let body: string | undefined;
  const bodyKeys = Object.keys(byLoc.body);
  if (bodyKeys.length > 0) {
    if (encoding === "form") {
      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(byLoc.body)) {
        form.set(k, String(v));
      }
      body = form.toString();
      headers["Content-Type"] =
        headers["Content-Type"] ?? "application/x-www-form-urlencoded";
    } else {
      body = JSON.stringify(byLoc.body);
      headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
    }
  }

  return {
    descriptor,
    operation,
    method,
    url: absolute.toString(),
    headers,
    body,
    bodyEncoding: bodyKeys.length ? encoding : undefined,
  };
}

function defaultEncoding(
  operation: ServiceOperation
): "json" | "form" {
  // Reddit-style comment endpoints historically use form bodies.
  if (operation.path === "/api/comment" || operation.id === "comment") {
    return "form";
  }
  return "json";
}
