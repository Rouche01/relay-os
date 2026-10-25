import type { EngineResult, ExecutionEngine } from "@relay/protocol";
import type {
  ComputerEngineAction,
  ComputerLeaseInfo,
} from "./types.js";

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
 * Typed client for the Computer Runtime gateway (lease → screenshot/action → release).
 * Inference stays outside — this engine only talks HTTP.
 */
export class ComputerEngine implements ExecutionEngine {
  public readonly type = "computer" as const;

  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly agentId?: string;
  private readonly defaultTtlSec: number;
  private readonly fetchImpl: typeof fetch;

  private sessionId: string | null = null;
  private apiBase: string | null = null;
  private vncUrl: string | null = null;
  private expiresAt: string | null = null;

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
    return this.vncUrl;
  }

  getApiBase(): string | null {
    return this.apiBase;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await this.request("GET", "/ready");
      return res.ok;
    } catch {
      return false;
    }
  }

  async teardown(): Promise<void> {
    if (!this.sessionId) return;
    try {
      await this.releaseSession();
    } catch {
      /* best-effort */
    }
  }

  async execute(action: ComputerEngineAction): Promise<EngineResult> {
    try {
      switch (action.type) {
        case "lease":
          return await this.lease(action);
        case "screenshot":
          return await this.screenshot();
        case "action":
          return await this.desktopAction(action);
        case "heartbeat":
          return await this.heartbeat(action);
        case "reset":
          return await this.reset();
        case "release":
          return await this.release();
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
    const body = {
      agent_id: action.params.agent_id ?? this.agentId,
      job_id: action.params.job_id,
      ttl_sec: action.params.ttl_sec ?? this.defaultTtlSec,
    };
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
    this.applyLease(lease);
    return {
      success: true,
      data: {
        session_id: lease.session_id,
        api_base: lease.api_base,
        vnc_url: lease.vnc_url,
        expires_at: lease.expires_at,
      },
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
        session_id: lease.session_id,
        expires_at: lease.expires_at,
        vnc_url: lease.vnc_url,
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

  private async release(): Promise<EngineResult> {
    await this.releaseSession();
    return { success: true, data: { ok: true } };
  }

  private async releaseSession(): Promise<void> {
    const sid = this.sessionId;
    if (!sid) return;
    const res = await this.request("DELETE", `/v1/sessions/${sid}`);
    this.clearLease();
    if (!res.ok && res.status !== 404) {
      throw new Error(
        `release failed (${res.status}): ${await this.readBody(res)}`
      );
    }
  }

  private applyLease(lease: ComputerLeaseInfo): void {
    this.sessionId = lease.session_id;
    this.apiBase = lease.api_base;
    this.vncUrl = lease.vnc_url;
    this.expiresAt = lease.expires_at;
  }

  private clearLease(): void {
    this.sessionId = null;
    this.apiBase = null;
    this.vncUrl = null;
    this.expiresAt = null;
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
    opts?: { jobId?: string }
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
    return this.fetchImpl(`${this.baseUrl}${path}`, {
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
