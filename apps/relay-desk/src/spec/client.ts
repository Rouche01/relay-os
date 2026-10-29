import { invoke } from "@tauri-apps/api/core";
import type { DeskSettings } from "../gateway/types.ts";
import type {
  EvalsResponse,
  FreezeResponse,
  LowerResponse,
  RunResponse,
  ScaffoldResponse,
  ValidateResponse,
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

async function specHttp(
  settings: DeskSettings,
  method: string,
  path: string,
  body?: unknown
): Promise<HttpResult> {
  const base = normalizeBase(settings.specApiUrl);
  const urlPath = path.startsWith("/") ? path : `/${path}`;

  if (await isTauri()) {
    return invoke<HttpResult>("gateway_http", {
      baseUrl: base,
      token: "",
      method,
      path: urlPath,
      bodyJson: body === undefined ? null : JSON.stringify(body),
    });
  }

  const headers: Record<string, string> = {};
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
  return JSON.parse(raw || "{}") as T;
}

export async function probeSpecApi(settings: DeskSettings): Promise<string> {
  const res = await specHttp(settings, "GET", "/api/health");
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Spec API probe failed (${res.status}): ${res.body.slice(0, 200)}`);
  }
  const data = parseJson<{ ok?: boolean; specV2?: boolean }>(res.body);
  if (!data.specV2) {
    throw new Error("Spec API reachable but Spec v2 routes not advertised — update relay-shell");
  }
  return `reachable · Spec v2 (HTTP ${res.status})`;
}

export async function scaffoldSpec(
  settings: DeskSettings,
  intent: string,
  opts?: { stub?: boolean }
): Promise<ScaffoldResponse> {
  const res = await specHttp(settings, "POST", "/api/v2/scaffold", {
    intent,
    stub: opts?.stub,
  });
  return { ...parseJson<ScaffoldResponse>(res.body), status: res.status };
}

export async function validateSpec(
  settings: DeskSettings,
  yaml: string
): Promise<ValidateResponse> {
  const res = await specHttp(settings, "POST", "/api/v2/validate", { yaml });
  return parseJson<ValidateResponse>(res.body);
}

export async function lowerSpec(
  settings: DeskSettings,
  yaml: string
): Promise<LowerResponse> {
  const res = await specHttp(settings, "POST", "/api/v2/lower", { yaml });
  return parseJson<LowerResponse>(res.body);
}

export async function evalSpec(
  settings: DeskSettings,
  yaml: string
): Promise<EvalsResponse> {
  const res = await specHttp(settings, "POST", "/api/v2/evals", { yaml });
  return parseJson<EvalsResponse>(res.body);
}

export async function freezeSpec(
  settings: DeskSettings,
  yaml: string
): Promise<FreezeResponse> {
  const res = await specHttp(settings, "POST", "/api/v2/freeze", { yaml });
  return parseJson<FreezeResponse>(res.body);
}

export async function runSpec(
  settings: DeskSettings,
  yaml: string,
  opts?: { autoApprove?: boolean }
): Promise<RunResponse> {
  const res = await specHttp(settings, "POST", "/api/v2/run", {
    yaml,
    autoApprove: opts?.autoApprove ?? true,
  });
  return parseJson<RunResponse>(res.body);
}
