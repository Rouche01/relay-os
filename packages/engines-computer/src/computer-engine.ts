import type { EngineResult, ExecutionEngine } from "@relay/protocol";
import type {
  ComputerEngineAction,
  ComputerLeaseInfo,
  ComputerObserveResult,
  ComputerSeatKind,
} from "./types.js";

/**
 * Prefer gateway `kind`. If omitted: default desktop for desktop/omit requests;
 * do not assume phone succeeded when an older gateway ignores the field.
 */
function leaseFallbackKind(
  lease: ComputerLeaseInfo,
  requested?: ComputerSeatKind
): ComputerSeatKind | undefined {
  if (lease.kind != null) return undefined;
  if (requested === "phone") return undefined;
  return "desktop";
}

export interface ComputerEngineOptions {
  /** Gateway origin, e.g. http://localhost:9000 */
  baseUrl: string;
  /** Bearer token when COMPUTER_API_TOKEN is set on the gateway */
  token?: string;
  /** Default agent_id on lease when params omit it */
  agentId?: string;
  defaultTtlSec?: number;
  /** Inject for tests */
  fetch?: typeof fetch;
}

/**
 * Typed client for the Computer Runtime gateway.
 *
 * Session lifecycle (gateway park model):
 * - `lease` — claim a free worker (`kind: "phone"` for phone seats; omit = desktop),
 *   or reattach a parked slot when `job_id` matches
 * - `release` — soft **park** (keep worker warm; clear local claim)
 * - `acquire` — re-lease a parked seat by `session_id`
 * - `recycle` — wipe worker state and free the seat
 *
 * After lease, `getKind()` / `getSeatId()` / `getVncUrl()` surface gateway seat metadata
 * (HITL: noVNC or scrcpy-web via the same `vnc_url` field).
 *
 * Inference stays outside — this engine only talks HTTP.
 */
export class ComputerEngine implements ExecutionEngine {
  public readonly type = "computer" as const;

  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly agentId?: string;
  private readonly defaultTtlSec: number;
  private readonly fetchImpl: typeof fetch;

  /** Active exclusive claim (leased). */
  private sessionId: string | null = null;
  private apiBase: string | null = null;
  private vncUrl: string | null = null;
  private expiresAt: string | null = null;
  private kind: ComputerSeatKind | null = null;
  private seatId: string | null = null;

  /** Last soft-parked session (for acquire without re-passing id). */
  private parkedSessionId: string | null = null;
  private parkedVncUrl: string | null = null;
  private parkedKind: ComputerSeatKind | null = null;
  private parkedSeatId: string | null = null;

  constructor(options: ComputerEngineOptions) {
    if (!options.baseUrl?.trim()) {
      throw new Error("ComputerEngine requires baseUrl");
    }
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.agentId = options.agentId;
    this.defaultTtlSec = options.defaultTtlSec ?? 600;
    this.fetchImpl = options.fetch ?? fetch;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  getVncUrl(): string | null {
    return this.vncUrl ?? this.parkedVncUrl;
  }

  /** Seat kind while leased or after soft park (`desktop` | `phone`). */
  getKind(): ComputerSeatKind | null {
    return this.kind ?? this.parkedKind;
  }

  /** Inventory seat id while leased or after soft park. */
  getSeatId(): string | null {
    return this.seatId ?? this.parkedSeatId;
  }

  getApiBase(): string | null {
    return this.apiBase;
  }

  /** Session id after soft park (null while exclusively leased or after recycle). */
  getParkedSessionId(): string | null {
    return this.parkedSessionId;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await this.request("GET", "/ready");
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Soft-park if leased (best-effort). Prefer `recycle` when the job is finished. */
  async teardown(): Promise<void> {
    if (!this.sessionId) return;
    try {
      await this.parkSession();
    } catch {
      /* best-effort */
    }
  }

  async execute(action: ComputerEngineAction): Promise<EngineResult> {
    try {
      switch (action.type) {
        case "lease":
          return await this.lease(action);
        case "acquire":
          return await this.acquire(action);
        case "screenshot":
          return await this.screenshot();
        case "observe":
          return await this.observe(action);
        case "action":
          return await this.desktopAction(action);
        case "heartbeat":
          return await this.heartbeat(action);
        case "reset":
          return await this.reset();
        case "release":
          return await this.release();
        case "recycle":
          return await this.recycle(action);
        default:
          return {
            success: false,
            error: `unknown computer action: ${(action as ComputerEngineAction).type}`,
          };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  private async lease(action: ComputerEngineAction): Promise<EngineResult> {
    if (this.sessionId) {
      return {
        success: false,
        error: `already leased session ${this.sessionId}; release first`,
      };
    }
    const body: {
      agent_id?: string;
      job_id?: string;
      ttl_sec: number;
      kind?: ComputerSeatKind;
    } = {
      agent_id: action.params.agent_id ?? this.agentId,
      job_id: action.params.job_id,
      ttl_sec: action.params.ttl_sec ?? this.defaultTtlSec,
    };
    if (action.params.kind) {
      body.kind = action.params.kind;
    }
    const res = await this.request("POST", "/v1/sessions", body, {
      jobId: action.params.job_id,
    });
    if (!res.ok) {
      const detail = await this.readBody(res);
      return {
        success: false,
        error: `lease failed (${res.status}): ${detail}`,
      };
    }
    const lease = (await res.json()) as ComputerLeaseInfo;
    // Never invent "phone" from the request — only trust the gateway (or
    // default desktop when both omit kind). Old gateways ignore `kind` and
    // return a desktop seat without echoing kind/seat_id.
    this.applyLease(lease, leaseFallbackKind(lease, action.params.kind));
    this.clearParked();
    return {
      success: true,
      data: this.leaseResultData({
        ...lease,
        kind: this.kind,
        seat_id: this.seatId,
      }),
    };
  }

  private async acquire(action: ComputerEngineAction): Promise<EngineResult> {
    if (this.sessionId) {
      return {
        success: false,
        error: `already leased session ${this.sessionId}; release first`,
      };
    }
    const sid =
      action.params.session_id?.trim() || this.parkedSessionId || undefined;
    if (!sid) {
      return {
        success: false,
        error: "acquire requires params.session_id or a prior soft-parked session",
      };
    }
    const body = {
      agent_id: action.params.agent_id ?? this.agentId,
      ttl_sec: action.params.ttl_sec ?? this.defaultTtlSec,
    };
    const res = await this.request(
      "POST",
      `/v1/sessions/${sid}/acquire`,
      body
    );
    if (!res.ok) {
      const detail = await this.readBody(res);
      return {
        success: false,
        error: `acquire failed (${res.status}): ${detail}`,
      };
    }
    const lease = (await res.json()) as ComputerLeaseInfo;
    this.applyLease(lease, this.parkedKind ?? undefined);
    this.clearParked();
    return {
      success: true,
      data: this.leaseResultData({
        ...lease,
        kind: this.kind,
        seat_id: this.seatId,
      }),
    };
  }

  private async screenshot(): Promise<EngineResult> {
    const sid = this.requireSession();
    const res = await this.request(
      "GET",
      `/v1/sessions/${sid}/screenshot`
    );
    if (!res.ok) {
      return {
        success: false,
        error: `screenshot failed (${res.status}): ${await this.readBody(res)}`,
      };
    }
    const data = (await res.json()) as { image?: string };
    return { success: true, data };
  }

  /**
   * Phone-only: screenshot + trimmed UIAutomator tree.
   * Desktop seats return 404 from the gateway — surfaced as a clear error.
   */
  private async observe(action: ComputerEngineAction): Promise<EngineResult> {
    const sid = this.requireSession();
    const query: Record<string, string> = {};
    if (
      action.params.max_elements != null &&
      Number.isFinite(action.params.max_elements)
    ) {
      query.max_elements = String(
        Math.max(1, Math.min(500, Math.trunc(action.params.max_elements)))
      );
    }
    const res = await this.request(
      "GET",
      `/v1/sessions/${sid}/observe`,
      undefined,
      { query: Object.keys(query).length > 0 ? query : undefined }
    );
    if (res.status === 404) {
      return {
        success: false,
        error:
          "observe is phone-only (desktop workers return 404); lease kind=phone or use screenshot",
      };
    }
    if (!res.ok) {
      return {
        success: false,
        error: `observe failed (${res.status}): ${await this.readBody(res)}`,
      };
    }
    const data = (await res.json()) as ComputerObserveResult;
    return { success: true, data };
  }

  private async desktopAction(
    action: ComputerEngineAction
  ): Promise<EngineResult> {
    const sid = this.requireSession();
    const payload = action.params.action;
    if (!payload?.type) {
      return {
        success: false,
        error: "action requires params.action with a type field",
      };
    }
    const res = await this.request(
      "POST",
      `/v1/sessions/${sid}/action`,
      payload
    );
    if (!res.ok) {
      return {
        success: false,
        error: `action failed (${res.status}): ${await this.readBody(res)}`,
      };
    }
    const data = await res.json().catch(() => ({ ok: true }));
    return { success: true, data };
  }

  private async heartbeat(action: ComputerEngineAction): Promise<EngineResult> {
    const sid = this.requireSession();
    const res = await this.request(
      "POST",
      `/v1/sessions/${sid}/heartbeat`,
      {
        ttl_sec: action.params.ttl_sec ?? this.defaultTtlSec,
      }
    );
    if (!res.ok) {
      return {
        success: false,
        error: `heartbeat failed (${res.status}): ${await this.readBody(res)}`,
      };
    }
    const lease = (await res.json()) as ComputerLeaseInfo;
    this.applyLease(lease);
    return {
      success: true,
      data: {
        ...this.leaseResultData(lease),
      },
    };
  }

  private async reset(): Promise<EngineResult> {
    const sid = this.requireSession();
    const res = await this.request("POST", `/v1/sessions/${sid}/reset`, {});
    if (!res.ok) {
      return {
        success: false,
        error: `reset failed (${res.status}): ${await this.readBody(res)}`,
      };
    }
    return { success: true, data: await res.json().catch(() => ({ ok: true })) };
  }

  /** Soft park — keep Firefox warm for later acquire / job_id reattach. */
  private async release(): Promise<EngineResult> {
    const sid = this.sessionId;
    if (!sid) {
      return { success: true, data: { ok: true, parked: false } };
    }
    const vnc = this.vncUrl;
    await this.parkSession();
    return {
      success: true,
      data: { ok: true, parked: true, session_id: sid, vnc_url: vnc },
    };
  }

  /** Wipe Firefox and free the worker (leased or use params.session_id / parked). */
  private async recycle(action: ComputerEngineAction): Promise<EngineResult> {
    const sid =
      this.sessionId ??
      action.params.session_id?.trim() ??
      this.parkedSessionId ??
      undefined;
    if (!sid) {
      return {
        success: false,
        error: "recycle requires an active, parked, or params.session_id session",
      };
    }
    const res = await this.request(
      "DELETE",
      `/v1/sessions/${sid}`,
      undefined,
      { query: { recycle: "true" } }
    );
    this.clearLease();
    this.clearParked();
    if (!res.ok && res.status !== 404) {
      return {
        success: false,
        error: `recycle failed (${res.status}): ${await this.readBody(res)}`,
      };
    }
    const data = await res.json().catch(() => ({ ok: true, recycled: true }));
    return { success: true, data };
  }

  private async parkSession(): Promise<void> {
    const sid = this.sessionId;
    if (!sid) return;
    const vnc = this.vncUrl;
    const kind = this.kind;
    const seatId = this.seatId;
    const res = await this.request("DELETE", `/v1/sessions/${sid}`);
    this.parkedSessionId = sid;
    this.parkedVncUrl = vnc;
    this.parkedKind = kind;
    this.parkedSeatId = seatId;
    this.clearLease();
    if (!res.ok && res.status !== 404) {
      throw new Error(
        `park (soft release) failed (${res.status}): ${await this.readBody(res)}`
      );
    }
  }

  private applyLease(
    lease: ComputerLeaseInfo,
    fallbackKind?: ComputerSeatKind | null
  ): void {
    this.sessionId = lease.session_id;
    this.apiBase = lease.api_base;
    this.vncUrl = lease.vnc_url;
    this.expiresAt = lease.expires_at;
    this.kind = lease.kind ?? fallbackKind ?? null;
    this.seatId = lease.seat_id ?? null;
  }

  private clearLease(): void {
    this.sessionId = null;
    this.apiBase = null;
    this.vncUrl = null;
    this.expiresAt = null;
    this.kind = null;
    this.seatId = null;
  }

  private clearParked(): void {
    this.parkedSessionId = null;
    this.parkedVncUrl = null;
    this.parkedKind = null;
    this.parkedSeatId = null;
  }

  private leaseResultData(lease: ComputerLeaseInfo): Record<string, unknown> {
    return {
      session_id: lease.session_id,
      api_base: lease.api_base,
      vnc_url: lease.vnc_url,
      expires_at: lease.expires_at,
      ...(lease.kind != null ? { kind: lease.kind } : {}),
      ...(lease.seat_id != null ? { seat_id: lease.seat_id } : {}),
    };
  }

  private requireSession(): string {
    if (!this.sessionId) {
      throw new Error("no leased session; execute type=lease first");
    }
    return this.sessionId;
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    opts?: { jobId?: string; query?: Record<string, string> }
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    if (opts?.jobId) {
      headers["X-Job-Id"] = opts.jobId;
    }
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    let url = `${this.baseUrl}${path}`;
    if (opts?.query && Object.keys(opts.query).length > 0) {
      const q = new URLSearchParams(opts.query);
      url += `?${q.toString()}`;
    }
    return this.fetchImpl(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  private async readBody(res: Response): Promise<string> {
    try {
      const text = await res.text();
      return text.slice(0, 500);
    } catch {
      return res.statusText;
    }
  }
}
