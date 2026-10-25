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
  /** lease */
  agent_id?: string;
  job_id?: string;
  ttl_sec?: number;
  /** action — forwarded to gateway */
  action?: ComputerActionPayload;
}

export type ComputerActionType =
  | "lease"
  | "screenshot"
  | "action"
  | "heartbeat"
  | "reset"
  | "release";

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
