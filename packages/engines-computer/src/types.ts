import type { EngineAction } from "@relay/protocol";

/** Body forwarded to Computer Runtime POST .../action */
export interface ComputerActionPayload {
  type: string;
  x?: number;
  y?: number;
  text?: string;
  direction?: string;
  amount?: number;
}

export interface ComputerLeaseParams {
  agent_id?: string;
  job_id?: string;
  ttl_sec?: number;
}

export interface ComputerActionParams {
  /** lease / acquire / heartbeat */
  agent_id?: string;
  job_id?: string;
  ttl_sec?: number;
  /**
   * acquire — session to reattach (default: last soft-parked session on this engine).
   */
  session_id?: string;
  /** action — forwarded to gateway */
  action?: ComputerActionPayload;
}

/**
 * Gateway session actions.
 *
 * - `release` — soft **park** (DELETE /v1/sessions/{id}): drop claim, keep Firefox warm
 * - `recycle` — wipe Firefox and free the worker (DELETE …?recycle=true)
 * - `acquire` — re-lease a parked desktop by session_id
 * - `lease` with the same `job_id` also reattaches a parked slot (gateway-side)
 */
export type ComputerActionType =
  | "lease"
  | "acquire"
  | "screenshot"
  | "action"
  | "heartbeat"
  | "reset"
  | "release"
  | "recycle";

export interface ComputerEngineAction extends EngineAction {
  type: ComputerActionType;
  params: ComputerActionParams;
}

export interface ComputerLeaseInfo {
  session_id: string;
  api_base: string;
  vnc_url: string;
  expires_at: string;
  agent_id?: string | null;
  job_id?: string | null;
}
