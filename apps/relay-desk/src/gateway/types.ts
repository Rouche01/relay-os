export interface DeskSettings {
  gatewayUrl: string;
  apiToken: string;
  jobId: string;
  agentId: string;
  ttlSec: number;
  /** CommunityEngager desk adapter bridge (`FEEDBACK_ADAPTER=desk`). */
  hitlUrl: string;
  hitlToken: string;
}

export interface ComputerLease {
  session_id: string;
  api_base?: string;
  vnc_url: string;
  expires_at?: string;
}

/** Gateway `GET /v1/seats` row — pool inventory for inspect / recycle. */
export type GatewaySeatState = "free" | "leased" | "parked";

export interface GatewaySeat {
  id: string;
  state: GatewaySeatState;
  vnc_url: string;
  worker_base_url?: string;
  session_id?: string | null;
  agent_id?: string | null;
  job_id?: string | null;
  expires_at?: string | null;
  parked_at?: string | null;
}

export interface GatewaySeatsResponse {
  ok: boolean;
  workers: number;
  free: number;
  leased: number;
  parked: number;
  seats: GatewaySeat[];
}

/** leased = exclusive claim; watching = stream only; parked = warm, no stream claim */
export type SeatPhase = "idle" | "leased" | "watching" | "parked" | "error";

export interface SeatState {
  phase: SeatPhase;
  sessionId?: string;
  vncUrl?: string;
  expiresAt?: string;
  error?: string;
  lastHeartbeatAt?: string;
}

export const DEFAULT_SETTINGS: DeskSettings = {
  gatewayUrl: "http://127.0.0.1:9000",
  apiToken: "dev-token",
  jobId: "relay-desk",
  agentId: "relay-desk",
  ttlSec: 600,
  hitlUrl: "http://127.0.0.1:9100",
  hitlToken: "",
};
