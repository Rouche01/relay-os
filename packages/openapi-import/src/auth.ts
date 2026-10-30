import type { ServiceAuth } from "@relay/protocol";
import type { OpenApiDocument, OpenApiSecurityScheme } from "./openapi-types.js";
import { resolveSecurityScheme } from "./resolve.js";

export type AuthOverride = "auto" | "none" | "bearer" | `apiKey:${string}`;

/**
 * Map OpenAPI securitySchemes / root security to Relay ServiceAuth.
 * Secrets never appear — only connection: true.
 */
export function mapAuth(
  doc: OpenApiDocument,
  override: AuthOverride = "auto"
): ServiceAuth | undefined {
  if (override === "none") return { type: "none" };
  if (override === "bearer") return { type: "bearer", connection: true };
  if (override.startsWith("apiKey:")) {
    const header = override.slice("apiKey:".length).trim();
    if (!header) throw new Error("auth apiKey: requires a header name");
    return { type: "apiKey", header, connection: true };
  }

  const schemes = doc.components?.securitySchemes ?? {};
  const names = Object.keys(schemes);
  if (!names.length) {
    // No security declared → public / none.
    return { type: "none" };
  }

  // Prefer schemes named in root security; else first usable scheme.
  const preferred = preferredSchemeNames(doc, names);
  for (const name of preferred) {
    const raw = schemes[name];
    if (!raw) continue;
    const scheme = resolveSecurityScheme(doc, raw);
    const mapped = schemeToAuth(scheme);
    if (mapped) return mapped;
  }

  return { type: "bearer", connection: true };
}

function preferredSchemeNames(
  doc: OpenApiDocument,
  all: string[]
): string[] {
  const fromRoot: string[] = [];
  for (const req of doc.security ?? []) {
    for (const name of Object.keys(req)) {
      if (!fromRoot.includes(name)) fromRoot.push(name);
    }
  }
  return fromRoot.length ? [...fromRoot, ...all.filter((n) => !fromRoot.includes(n))] : all;
}

function schemeToAuth(scheme: OpenApiSecurityScheme): ServiceAuth | undefined {
  const type = String(scheme.type ?? "").toLowerCase();
  if (type === "http") {
    const s = String(scheme.scheme ?? "").toLowerCase();
    if (s === "bearer" || s === "token") {
      return { type: "bearer", connection: true };
    }
    // basic etc. → still treat as bearer connection slot for Relay.
    return { type: "bearer", connection: true };
  }
  if (type === "apikey") {
    if (String(scheme.in ?? "").toLowerCase() === "header" && scheme.name) {
      return {
        type: "apiKey",
        header: scheme.name,
        connection: true,
      };
    }
    // query/cookie apiKey → bearer connection (Relay only supports header apiKey).
    return { type: "bearer", connection: true };
  }
  if (type === "oauth2" || type === "openIdConnect") {
    return { type: "bearer", connection: true };
  }
  return undefined;
}
