import { invoke } from "@tauri-apps/api/core";
import type { DeskSettings } from "../gateway/types.ts";
import type { AppRunSummary, InstalledAppSummary } from "./types.ts";

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

async function appHttp(
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

  // Vite dogfood: same-origin proxy when Spec API is local (shell has no CORS).
  let fetchBase = base;
  try {
    const u = new URL(base);
    if (
      (u.hostname === "127.0.0.1" ||
        u.hostname === "localhost" ||
        u.hostname === "::1") &&
      (u.port === "8790" || u.port === "")
    ) {
      fetchBase = "/__desk/spec";
    }
  } catch {
    /* keep base */
  }

  const headers: Record<string, string> = {};
  let payload: string | undefined;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  try {
    const res = await fetch(`${fetchBase}${urlPath}`, {
      method,
      headers,
      body: payload,
    });
    return { status: res.status, body: await res.text() };
  } catch (err) {
    throw new Error(
      err instanceof Error
        ? err.message
        : "Apps API request failed (CORS/network) — use the Tauri Desk window or Vite proxy"
    );
  }
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw || "{}") as T;
}

export async function listApps(
  settings: DeskSettings
): Promise<{ ok: boolean; apps?: InstalledAppSummary[]; error?: string }> {
  const res = await appHttp(settings, "GET", "/api/v2/apps");
  return parseJson(res.body);
}

export async function installAppJson(
  settings: DeskSettings,
  json: string
): Promise<{
  ok: boolean;
  app?: InstalledAppSummary;
  error?: string;
  note?: string;
}> {
  const res = await appHttp(settings, "POST", "/api/v2/apps/install", {
    json,
  });
  return parseJson(res.body);
}

export async function getApp(
  settings: DeskSettings,
  id: string
): Promise<{
  ok: boolean;
  summary?: InstalledAppSummary;
  yaml?: string;
  app?: {
    connections: Record<string, { connected: boolean }>;
    bundle: { requiredConnections: string[] };
    lastShadowRunId?: string;
  };
  error?: string;
}> {
  const res = await appHttp(
    settings,
    "GET",
    `/api/v2/apps/${encodeURIComponent(id)}`
  );
  return parseJson(res.body);
}

export async function connectApp(
  settings: DeskSettings,
  id: string,
  connection: string,
  connected = true
): Promise<{
  ok: boolean;
  app?: InstalledAppSummary;
  error?: string;
  note?: string;
}> {
  const res = await appHttp(
    settings,
    "POST",
    `/api/v2/apps/${encodeURIComponent(id)}/connect`,
    { connection, connected }
  );
  return parseJson(res.body);
}

/** Probe Spec API env for live secrets (does not return token values). */
export async function probeConnections(settings: DeskSettings): Promise<{
  ok: boolean;
  connections?: Array<{ id: string; liveSecret: boolean }>;
  error?: string;
  note?: string;
}> {
  const res = await appHttp(settings, "GET", "/api/v2/connections");
  return parseJson(res.body);
}

export async function shadowRunApp(
  settings: DeskSettings,
  id: string
): Promise<{
  ok: boolean;
  runId?: string;
  state?: string;
  error?: string;
  note?: string;
  app?: InstalledAppSummary;
}> {
  const res = await appHttp(
    settings,
    "POST",
    `/api/v2/apps/${encodeURIComponent(id)}/shadow-run`,
    { autoApprove: true }
  );
  return parseJson(res.body);
}

export async function approveAppEvidence(
  settings: DeskSettings,
  id: string,
  runId?: string
): Promise<{
  ok: boolean;
  error?: string;
  note?: string;
  app?: InstalledAppSummary;
}> {
  const res = await appHttp(
    settings,
    "POST",
    `/api/v2/apps/${encodeURIComponent(id)}/approve-evidence`,
    { runId }
  );
  return parseJson(res.body);
}

export async function enableApp(
  settings: DeskSettings,
  id: string
): Promise<{
  ok: boolean;
  error?: string;
  note?: string;
  app?: InstalledAppSummary;
}> {
  const res = await appHttp(
    settings,
    "POST",
    `/api/v2/apps/${encodeURIComponent(id)}/enable`
  );
  return parseJson(res.body);
}

/** On-demand live run (HITL may pause for Seats). Does not require schedule enabled. */
export async function runAppOnce(
  settings: DeskSettings,
  id: string
): Promise<{
  ok: boolean;
  runId?: string;
  state?: string;
  error?: string;
  note?: string;
  app?: InstalledAppSummary;
}> {
  const res = await appHttp(
    settings,
    "POST",
    `/api/v2/apps/${encodeURIComponent(id)}/run`
  );
  return parseJson(res.body);
}

export async function pauseApp(
  settings: DeskSettings,
  id: string
): Promise<{ ok: boolean; error?: string; app?: InstalledAppSummary }> {
  const res = await appHttp(
    settings,
    "POST",
    `/api/v2/apps/${encodeURIComponent(id)}/pause`
  );
  return parseJson(res.body);
}

export async function resumeApp(
  settings: DeskSettings,
  id: string
): Promise<{ ok: boolean; error?: string; app?: InstalledAppSummary }> {
  const res = await appHttp(
    settings,
    "POST",
    `/api/v2/apps/${encodeURIComponent(id)}/resume`
  );
  return parseJson(res.body);
}

export async function disableApp(
  settings: DeskSettings,
  id: string
): Promise<{ ok: boolean; error?: string; app?: InstalledAppSummary }> {
  const res = await appHttp(
    settings,
    "POST",
    `/api/v2/apps/${encodeURIComponent(id)}/disable`
  );
  return parseJson(res.body);
}

export async function thawApp(
  settings: DeskSettings,
  id: string
): Promise<{
  ok: boolean;
  yaml?: string;
  note?: string;
  error?: string;
  app?: InstalledAppSummary;
}> {
  const res = await appHttp(
    settings,
    "POST",
    `/api/v2/apps/${encodeURIComponent(id)}/thaw`
  );
  return parseJson(res.body);
}

export async function refreezeApp(
  settings: DeskSettings,
  id: string,
  yaml: string
): Promise<{
  ok: boolean;
  note?: string;
  error?: string;
  app?: InstalledAppSummary;
}> {
  const res = await appHttp(
    settings,
    "POST",
    `/api/v2/apps/${encodeURIComponent(id)}/refreeze`,
    { yaml }
  );
  return parseJson(res.body);
}

export async function listAppRuns(
  settings: DeskSettings,
  id: string
): Promise<{ ok: boolean; runs?: AppRunSummary[]; error?: string }> {
  const res = await appHttp(
    settings,
    "GET",
    `/api/v2/apps/${encodeURIComponent(id)}/runs`
  );
  return parseJson(res.body);
}

export async function uninstallApp(
  settings: DeskSettings,
  id: string
): Promise<{ ok: boolean; error?: string }> {
  const res = await appHttp(
    settings,
    "DELETE",
    `/api/v2/apps/${encodeURIComponent(id)}`
  );
  return parseJson(res.body);
}
