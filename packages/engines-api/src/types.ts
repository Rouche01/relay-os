import type { ServiceDescriptor, ServiceHttpMethod } from "@relay/protocol";

/** Resolved credentials for a Spec connection ref — never stored on the Spec. */
export type ConnectionCredentials =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "apiKey"; header: string; value: string };

export type ConnectionResolver = (
  connectionId: string
) =>
  | ConnectionCredentials
  | undefined
  | Promise<ConnectionCredentials | undefined>;

/**
 * Fixture for replay (tests / dry dogfood).
 * First match wins: service + operation (+ optional params subset).
 */
export type ApiFixture = {
  service: string;
  operation: string;
  /** When set, every key must deep-equal the request param. */
  params?: Record<string, unknown>;
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
};

/** Optional per-operation wire hints (encoding, etc.). */
export type ApiOperationHint = {
  /** Default json. Reddit OAuth comment uses form. */
  bodyEncoding?: "json" | "form";
};

export type ApiRequestParams = {
  service: string;
  operation: string;
  method?: ServiceHttpMethod | string;
  params?: Record<string, unknown>;
  connection?: string;
  /** Override dry-run for this call. */
  dryRun?: boolean;
  bodyEncoding?: "json" | "form";
};

export type ApiEngineOptions = {
  services: readonly ServiceDescriptor[];
  resolveConnection?: ConnectionResolver;
  /**
   * When true (default), irreversible methods do not hit the network —
   * return a simulated success with `dryRunSimulated: true`.
   * Fixtures still apply for any method when matched.
   */
  dryRun?: boolean;
  fixtures?: readonly ApiFixture[];
  /** Keys: `serviceId.operationId`. */
  operationHints?: Record<string, ApiOperationHint>;
  fetch?: typeof fetch;
  defaultTimeoutMs?: number;
  userAgent?: string;
};

export type ApiRequestResultData = {
  service: string;
  operation: string;
  method: ServiceHttpMethod;
  url: string;
  status: number;
  headers: Record<string, string>;
  body: unknown;
  dryRunSimulated?: boolean;
  fixture?: boolean;
};
