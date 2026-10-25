import type { ComputerEngine } from "@relay/engines-computer";

export interface ComputerRunSessionOptions {
  engine: ComputerEngine;
  /**
   * Stable gateway job_id for the whole engage run.
   * Prefer `engageJobId(agentSessionId)`.
   */
  jobId: string;
  agentId?: string;
  ttlSec?: number;
}

export interface ComputerRunLeaseResult {
  ok: boolean;
  sessionId?: string;
  vncUrl?: string;
  error?: string;
  /** True when we reattached a parked desktop (acquire or job_id lease). */
  reattached?: boolean;
}

/**
 * Build the stable Computer Runtime job_id for one engage parent run.
 * Gateway reattaches a parked worker when the same job_id is leased again.
 */
export function engageJobId(runSessionId: string): string {
  const id = runSessionId.trim() || "unknown";
  return `engage:${id}`;
}

/**
 * Run-scoped desktop handle: one warm Firefox across preview → HITL → execute.
 *
 * Lifecycle: ensureLeased → act → park (soft) → … → ensureLeased → act → recycle.
 */
export class ComputerRunSession {
  readonly jobId: string;
  readonly engine: ComputerEngine;
  private readonly agentId?: string;
  private readonly ttlSec?: number;

  /** Last known gateway session (leased or parked). */
  sessionId?: string;
  /** Last known VNC URL (kept after soft park for HITL). */
  vncUrl?: string;

  private recycled = false;

  constructor(options: ComputerRunSessionOptions) {
    if (!options.jobId?.trim()) {
      throw new Error("ComputerRunSession requires jobId");
    }
    this.engine = options.engine;
    this.jobId = options.jobId.trim();
    this.agentId = options.agentId;
    this.ttlSec = options.ttlSec;
  }

  get isRecycled(): boolean {
    return this.recycled;
  }

  /** True when this engine currently holds an exclusive lease. */
  get isLeased(): boolean {
    return Boolean(this.engine.getSessionId());
  }

  /**
   * Ensure we hold an exclusive lease on the run desktop.
   * Prefers acquire of a soft-parked session, else lease with this.jobId
   * (gateway reattaches parked slots with the same job_id).
   */
  async ensureLeased(): Promise<ComputerRunLeaseResult> {
    if (this.recycled) {
      return { ok: false, error: "computer run session already recycled" };
    }

    const active = this.engine.getSessionId();
    if (active) {
      this.syncFromEngine();
      return {
        ok: true,
        sessionId: this.sessionId,
        vncUrl: this.vncUrl,
        reattached: false,
      };
    }

    const parked =
      this.engine.getParkedSessionId() ?? this.sessionId ?? undefined;
    if (parked) {
      const acq = await this.engine.execute({
        type: "acquire",
        params: {
          session_id: parked,
          agent_id: this.agentId,
          ttl_sec: this.ttlSec,
        },
      });
      if (acq.success) {
        this.syncFromEngine();
        return {
          ok: true,
          sessionId: this.sessionId,
          vncUrl: this.vncUrl,
          reattached: true,
        };
      }
      // Fall through to job_id lease if acquire failed (e.g. already expired).
    }

    const lease = await this.engine.execute({
      type: "lease",
      params: {
        job_id: this.jobId,
        agent_id: this.agentId,
        ttl_sec: this.ttlSec,
      },
    });
    if (!lease.success) {
      return {
        ok: false,
        error: lease.error ?? "computer lease failed",
      };
    }
    this.syncFromEngine();
    const reattached =
      Boolean(parked) ||
      (typeof lease.data?.session_id === "string" &&
        parked != null &&
        lease.data.session_id === parked);
    return {
      ok: true,
      sessionId: this.sessionId,
      vncUrl: this.vncUrl,
      reattached,
    };
  }

  /** Soft park — keep Firefox warm for HITL / later ensureLeased. */
  async park(): Promise<{ ok: boolean; error?: string }> {
    if (this.recycled) {
      return { ok: false, error: "computer run session already recycled" };
    }
    if (!this.engine.getSessionId()) {
      this.syncFromEngine();
      return { ok: true };
    }
    const rel = await this.engine.execute({ type: "release", params: {} });
    if (!rel.success) {
      return { ok: false, error: rel.error ?? "park failed" };
    }
    this.sessionId =
      (rel.data?.session_id as string | undefined) ??
      this.engine.getParkedSessionId() ??
      this.sessionId;
    this.vncUrl =
      (rel.data?.vnc_url as string | undefined) ??
      this.engine.getVncUrl() ??
      this.vncUrl;
    return { ok: true };
  }

  /** Wipe Firefox and free the worker — end of engage run. */
  async recycle(): Promise<{ ok: boolean; error?: string }> {
    if (this.recycled) {
      return { ok: true };
    }
    const sid =
      this.engine.getSessionId() ??
      this.engine.getParkedSessionId() ??
      this.sessionId;
    if (!sid) {
      this.recycled = true;
      return { ok: true };
    }
    const result = await this.engine.execute({
      type: "recycle",
      params: { session_id: sid },
    });
    this.recycled = true;
    if (!result.success) {
      return { ok: false, error: result.error ?? "recycle failed" };
    }
    this.sessionId = undefined;
    this.vncUrl = undefined;
    return { ok: true };
  }

  private syncFromEngine(): void {
    this.sessionId =
      this.engine.getSessionId() ??
      this.engine.getParkedSessionId() ??
      this.sessionId;
    this.vncUrl = this.engine.getVncUrl() ?? this.vncUrl;
  }
}

export function createComputerRunSession(
  options: ComputerRunSessionOptions
): ComputerRunSession {
  return new ComputerRunSession(options);
}
