import { invoke } from "@tauri-apps/api/core";
import type { ComputerLease, DeskSettings } from "./types.ts";
import { withVncViewerParams } from "./vnc-url.ts";

export interface GatewayHttpResult {
  status: number;
  body: string;
}

function normalizeBase(url: string): string {
  return url.replace(/\/+$/, "");
}

async function isTauri(): Promise<boolean> {
  try {
    return Boolean(
      (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    );
  } catch {
    return false;
  }
}

/**
 * HTTP via Rust (no CORS) when running under Tauri; fetch() for Vite-only dogfood.
 */
async function gatewayHttp(
  settings: DeskSettings,
  method: string,
  path: string,
  body?: unknown
): Promise<GatewayHttpResult> {
  const base = normalizeBase(settings.gatewayUrl);
  const urlPath = path.startsWith("/") ? path : `/${path}`;

  if (await isTauri()) {
    return invoke<GatewayHttpResult>("gateway_http", {
      baseUrl: base,
      token: settings.apiToken,
      method,
      path: urlPath,
      bodyJson:
        body === undefined ? null : JSON.stringify(body),
    });
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${settings.apiToken}`,
  };
  let payload: string | undefined;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers,
    body: payload,
  });
  return { status: res.status, body: await res.text() };
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function failStatus(op: string, status: number, body: string): never {
  throw new Error(`${op} failed (${status}): ${body.slice(0, 400)}`);
}

export async function probeGateway(settings: DeskSettings): Promise<string> {
  // Prefer OpenAPI root; fall back to sessions probe that may 405/401.
  try {
    const docs = await gatewayHttp(settings, "GET", "/docs");
    if (docs.status > 0 && docs.status < 500) {
      return `reachable (HTTP ${docs.status})`;
    }
  } catch {
    /* try openapi */
  }
  const openapi = await gatewayHttp(settings, "GET", "/openapi.json");
  if (openapi.status > 0 && openapi.status < 500) {
    return `reachable (HTTP ${openapi.status})`;
  }
  failStatus("probe", openapi.status, openapi.body);
}

export async function leaseSession(
  settings: DeskSettings
): Promise<ComputerLease> {
  const res = await gatewayHttp(settings, "POST", "/v1/sessions", {
    agent_id: settings.agentId,
    job_id: settings.jobId,
    ttl_sec: settings.ttlSec,
  });
  if (res.status < 200 || res.status >= 300) {
    failStatus("lease", res.status, res.body);
  }
  const lease = parseJson<ComputerLease>(res.body);
  return {
    ...lease,
    vnc_url: withVncViewerParams(lease.vnc_url),
  };
}

export async function acquireSession(
  settings: DeskSettings,
  sessionId: string
): Promise<ComputerLease> {
  const res = await gatewayHttp(
    settings,
    "POST",
    `/v1/sessions/${encodeURIComponent(sessionId)}/acquire`,
    {
      agent_id: settings.agentId,
      ttl_sec: settings.ttlSec,
    }
  );
  if (res.status < 200 || res.status >= 300) {
    failStatus("acquire", res.status, res.body);
  }
  const lease = parseJson<ComputerLease>(res.body);
  return {
    ...lease,
    vnc_url: withVncViewerParams(lease.vnc_url),
  };
}

export async function heartbeatSession(
  settings: DeskSettings,
  sessionId: string
): Promise<void> {
  const res = await gatewayHttp(
    settings,
    "POST",
    `/v1/sessions/${encodeURIComponent(sessionId)}/heartbeat`
  );
  if (res.status < 200 || res.status >= 300) {
    failStatus("heartbeat", res.status, res.body);
  }
}

/** Soft park — keep Firefox warm. */
export async function softReleaseSession(
  settings: DeskSettings,
  sessionId: string
): Promise<{ parked: boolean }> {
  const res = await gatewayHttp(
    settings,
    "DELETE",
    `/v1/sessions/${encodeURIComponent(sessionId)}`
  );
  if (res.status < 200 || (res.status >= 300 && res.status !== 404)) {
    failStatus("soft-release", res.status, res.body);
  }
  try {
    const data = parseJson<{ parked?: boolean }>(res.body || "{}");
    return { parked: data.parked !== false };
  } catch {
    return { parked: true };
  }
}

/** Wipe Firefox and free the worker. */
export async function recycleSession(
  settings: DeskSettings,
  sessionId: string
): Promise<void> {
  const res = await gatewayHttp(
    settings,
    "DELETE",
    `/v1/sessions/${encodeURIComponent(sessionId)}?recycle=true`
  );
  if (res.status < 200 || (res.status >= 300 && res.status !== 404)) {
    failStatus("recycle", res.status, res.body);
  }
}
