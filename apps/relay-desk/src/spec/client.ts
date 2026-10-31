import { invoke } from "@tauri-apps/api/core";
import type { DeskSettings } from "../gateway/types.ts";
import type {
  EvalsResponse,
  FreezeResponse,
  LowerResponse,
  ApproveEvidenceResponse,
  EnableScheduleResponse,
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
  body?: unknown,
  opts?: { timeoutMs?: number }
): Promise<HttpResult> {
  const base = normalizeBase(settings.specApiUrl);
  const urlPath = path.startsWith("/") ? path : `/${path}`;
  const timeoutMs = opts?.timeoutMs;

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
  const signal =
    timeoutMs && timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
  try {
    const res = await fetch(`${base}${urlPath}`, {
      method,
      headers,
      body: payload,
      signal,
    });
    return { status: res.status, body: await res.text() };
  } catch (err) {
    if (
      err instanceof DOMException &&
      (err.name === "TimeoutError" || err.name === "AbortError")
    ) {
      throw new Error(
        `Spec API timed out after ${Math.round((timeoutMs ?? 0) / 1000)}s — check LLM key / network, or retry`
      );
    }
    throw err;
  }
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw || "{}") as T;
}

export async function probeSpecApi(settings: DeskSettings): Promise<string> {
  const res = await specHttp(settings, "GET", "/api/health");
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Spec API probe failed (${res.status}): ${res.body.slice(0, 200)}`);
  }
  const data = parseJson<{
    ok?: boolean;
    specV2?: boolean;
    llmProvider?: string;
  }>(res.body);
  if (!data.specV2) {
    throw new Error("Spec API reachable but Spec v2 routes not advertised — update relay-shell");
  }
  const llm = data.llmProvider ? ` · llm ${data.llmProvider}` : "";
  return `reachable · Spec v2${llm} (HTTP ${res.status})`;
}

/** Provider advertised by Spec API health (`anthropic` | `gemini` | `stub` | …). */
export async function fetchScaffoldProvider(
  settings: DeskSettings
): Promise<string> {
  try {
    const res = await specHttp(settings, "GET", "/api/health");
    const data = parseJson<{ llmProvider?: string }>(res.body);
    return (data.llmProvider || "llm").trim() || "llm";
  } catch {
    return "llm";
  }
}

/** Live LLM scaffold often takes 30–90s (draft + repair loop). */
const SCAFFOLD_TIMEOUT_MS = 120_000;

export async function scaffoldSpec(
  settings: DeskSettings,
  intent: string,
  opts?: { stub?: boolean }
): Promise<ScaffoldResponse> {
  const payload: { intent: string; stub?: boolean } = { intent };
  if (opts?.stub !== undefined) payload.stub = opts.stub;
  const res = await specHttp(settings, "POST", "/api/v2/scaffold", payload, {
    timeoutMs: SCAFFOLD_TIMEOUT_MS,
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
  opts?: { autoApprove?: boolean; mode?: "fixture" | "shadow" }
): Promise<RunResponse> {
  const res = await specHttp(settings, "POST", "/api/v2/run", {
    yaml,
    autoApprove: opts?.autoApprove ?? true,
    mode: opts?.mode ?? "fixture",
  });
  return parseJson<RunResponse>(res.body);
}

export async function approveEvidence(
  settings: DeskSettings,
  runId: string,
  opts?: { approvedBy?: string; note?: string }
): Promise<ApproveEvidenceResponse> {
  const res = await specHttp(
    settings,
    "POST",
    `/api/v2/runs/${encodeURIComponent(runId)}/approve-evidence`,
    {
      approvedBy: opts?.approvedBy,
      note: opts?.note,
    }
  );
  return parseJson<ApproveEvidenceResponse>(res.body);
}

export async function enableSchedule(
  settings: DeskSettings,
  yaml: string,
  opts?: { runId?: string }
): Promise<EnableScheduleResponse> {
  const res = await specHttp(settings, "POST", "/api/v2/schedule/enable", {
    yaml,
    runId: opts?.runId,
  });
  return parseJson<EnableScheduleResponse>(res.body);
}

export async function processOutcomes(
  settings: DeskSettings,
  opts?: {
    ruleId?: string;
    specHash?: string;
    now?: string;
    value?: number;
  }
): Promise<{
  ok: boolean;
  error?: string;
  processed?: number;
  runIds?: string[];
  note?: string;
}> {
  const res = await specHttp(settings, "POST", "/api/v2/outcomes/process", {
    ruleId: opts?.ruleId,
    specHash: opts?.specHash,
    now: opts?.now,
    value: opts?.value,
  });
  return parseJson(res.body);
}
