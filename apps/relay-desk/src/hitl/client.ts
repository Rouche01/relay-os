import { invoke } from "@tauri-apps/api/core";
import type { DeskSettings } from "../gateway/types.ts";
import type {
  FeedbackAction,
  PendingFeedback,
  PendingListResponse,
} from "./types.ts";

interface HttpResult {
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

async function hitlHttp(
  settings: DeskSettings,
  method: string,
  path: string,
  body?: unknown
): Promise<HttpResult> {
  const base = normalizeBase(settings.hitlUrl);
  const urlPath = path.startsWith("/") ? path : `/${path}`;
  const token = settings.hitlToken;

  if (await isTauri()) {
    return invoke<HttpResult>("gateway_http", {
      baseUrl: base,
      token,
      method,
      path: urlPath,
      bodyJson: body === undefined ? null : JSON.stringify(body),
    });
  }

  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
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

export async function probeHitl(settings: DeskSettings): Promise<string> {
  const res = await hitlHttp(settings, "GET", "/health");
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HITL probe failed (${res.status}): ${res.body.slice(0, 200)}`);
  }
  return `reachable (HTTP ${res.status})`;
}

export async function fetchPending(
  settings: DeskSettings
): Promise<PendingFeedback[]> {
  const res = await hitlHttp(settings, "GET", "/v1/pending");
  if (res.status === 401) {
    throw new Error("HITL unauthorized — set DESK_HITL_TOKEN / hitlToken");
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HITL pending failed (${res.status}): ${res.body.slice(0, 200)}`);
  }
  const data = JSON.parse(res.body || "{}") as PendingListResponse;
  return Array.isArray(data.pending) ? data.pending : [];
}

export async function respondHitl(
  settings: DeskSettings,
  requestId: string,
  action: FeedbackAction,
  value?: unknown
): Promise<void> {
  const res = await hitlHttp(settings, "POST", "/v1/respond", {
    requestId,
    action,
    value,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HITL respond failed (${res.status}): ${res.body.slice(0, 200)}`);
  }
}
