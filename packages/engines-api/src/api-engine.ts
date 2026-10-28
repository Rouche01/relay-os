import type {
  EngineAction,
  EngineResult,
  ExecutionEngine,
} from "@relay/protocol";
import {
  indexServiceDescriptors,
  serviceOperationIsIrreversible,
  type ServiceDescriptor,
} from "@relay/protocol";
import { buildApiRequest } from "./build-request.js";
import type {
  ApiEngineOptions,
  ApiFixture,
  ApiRequestParams,
  ApiRequestResultData,
  ConnectionCredentials,
} from "./types.js";

function matchFixture(
  fixtures: readonly ApiFixture[],
  service: string,
  operation: string,
  params: Record<string, unknown>
): ApiFixture | undefined {
  for (const f of fixtures) {
    if (f.service !== service || f.operation !== operation) continue;
    if (!f.params) return f;
    let ok = true;
    for (const [k, v] of Object.entries(f.params)) {
      if (JSON.stringify(params[k]) !== JSON.stringify(v)) {
        ok = false;
        break;
      }
    }
    if (ok) return f;
  }
  return undefined;
}

function responseHeaders(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * Generic HTTP engine for Spec v2 `api.request`.
 *
 * - Validates service/operation against descriptors
 * - Resolves connection refs to credentials (no secrets on Specs)
 * - Replays fixtures when matched
 * - dryRun (default true): irreversible methods simulate without network
 */
export class ApiEngine implements ExecutionEngine {
  public readonly type = "api" as const;

  private readonly services: Map<string, ServiceDescriptor>;
  private readonly resolveConnection: ApiEngineOptions["resolveConnection"];
  private readonly dryRun: boolean;
  private readonly fixtures: readonly ApiFixture[];
  private readonly operationHints: NonNullable<ApiEngineOptions["operationHints"]>;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultTimeoutMs: number;
  private readonly userAgent: string;

  constructor(options: ApiEngineOptions) {
    if (!options.services?.length) {
      throw new Error("ApiEngine requires at least one service descriptor");
    }
    this.services = indexServiceDescriptors(options.services);
    this.resolveConnection = options.resolveConnection;
    this.dryRun = options.dryRun ?? true;
    this.fixtures = options.fixtures ?? [];
    this.operationHints = options.operationHints ?? {};
    this.fetchImpl = options.fetch ?? fetch;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
    this.userAgent = options.userAgent ?? "RelayApiEngine/0.1";
  }

  async healthCheck(): Promise<boolean> {
    return this.services.size > 0;
  }

  async teardown(): Promise<void> {}

  async execute(action: EngineAction): Promise<EngineResult> {
    if (action.type !== "request" && action.type !== "api.request") {
      return {
        success: false,
        error: `Unsupported api action: ${action.type} (use request)`,
      };
    }
    try {
      const data = await this.request(action.params as ApiRequestParams, {
        timeoutMs: action.timeout_ms,
      });
      return { success: true, data };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Typed entry for workflow runtime / tests.
   */
  async request(
    input: ApiRequestParams,
    opts?: { timeoutMs?: number }
  ): Promise<ApiRequestResultData> {
    const serviceId = String(input.service ?? "").trim();
    const operationId = String(input.operation ?? "").trim();
    if (!serviceId || !operationId) {
      throw new Error("api.request requires service and operation");
    }

    const descriptor = this.services.get(serviceId);
    if (!descriptor) {
      throw new Error(`Unknown service ${JSON.stringify(serviceId)}`);
    }

    const hintKey = `${serviceId}.${operationId}`;
    const built = buildApiRequest(
      descriptor,
      input,
      this.operationHints[hintKey]
    );
    if ("error" in built) {
      throw new Error(built.error);
    }

    const params = input.params ?? {};
    const fixture = matchFixture(
      this.fixtures,
      serviceId,
      operationId,
      params
    );
    if (fixture) {
      return {
        service: serviceId,
        operation: operationId,
        method: built.method,
        url: built.url,
        status: fixture.status ?? 200,
        headers: fixture.headers ?? {},
        body: fixture.body,
        fixture: true,
      };
    }

    const dryRun = input.dryRun ?? this.dryRun;
    if (dryRun && serviceOperationIsIrreversible(built.operation)) {
      return {
        service: serviceId,
        operation: operationId,
        method: built.method,
        url: built.url,
        status: 200,
        headers: { "x-relay-dry-run": "1" },
        body: {
          dryRun: true,
          simulated: true,
          service: serviceId,
          operation: operationId,
          wouldSend: {
            method: built.method,
            url: built.url,
            body: built.body ?? null,
          },
        },
        dryRunSimulated: true,
      };
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": this.userAgent,
      ...built.headers,
    };

    await this.applyAuth(headers, descriptor, input.connection);

    const timeoutMs = opts?.timeoutMs ?? this.defaultTimeoutMs;
    const res = await this.fetchImpl(built.url, {
      method: built.method,
      headers,
      body:
        built.method === "GET" || built.method === "HEAD"
          ? undefined
          : built.body,
      signal: AbortSignal.timeout(timeoutMs),
    });

    const body = await parseBody(res);
    if (!res.ok) {
      throw new Error(
        `api.request ${serviceId}.${operationId} failed: HTTP ${res.status} ${typeof body === "string" ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200)}`
      );
    }

    return {
      service: serviceId,
      operation: operationId,
      method: built.method,
      url: built.url,
      status: res.status,
      headers: responseHeaders(res),
      body,
    };
  }

  private async applyAuth(
    headers: Record<string, string>,
    descriptor: ServiceDescriptor,
    connectionId: string | undefined
  ): Promise<void> {
    const auth = descriptor.auth ?? { type: "none" as const };
    if (auth.type === "none") return;

    if (!connectionId?.trim()) {
      throw new Error(
        `Service ${JSON.stringify(descriptor.id)} requires a connection ref`
      );
    }
    if (!this.resolveConnection) {
      throw new Error(
        `Service ${JSON.stringify(descriptor.id)} needs resolveConnection for ${JSON.stringify(connectionId)}`
      );
    }
    const creds = await this.resolveConnection(connectionId);
    if (!creds) {
      throw new Error(`Unknown connection ${JSON.stringify(connectionId)}`);
    }
    applyCredentials(headers, auth, creds, connectionId);
  }
}

function applyCredentials(
  headers: Record<string, string>,
  auth: NonNullable<ServiceDescriptor["auth"]>,
  creds: ConnectionCredentials,
  connectionId: string
): void {
  if (auth.type === "bearer") {
    if (creds.type !== "bearer" || !creds.token) {
      throw new Error(
        `Connection ${JSON.stringify(connectionId)} must provide bearer token`
      );
    }
    headers.Authorization = `Bearer ${creds.token}`;
    return;
  }
  if (auth.type === "apiKey") {
    if (creds.type !== "apiKey" || !creds.value) {
      throw new Error(
        `Connection ${JSON.stringify(connectionId)} must provide apiKey`
      );
    }
    const header = creds.header || auth.header;
    headers[header] = creds.value;
  }
}

export function createApiEngine(options: ApiEngineOptions): ApiEngine {
  return new ApiEngine(options);
}
