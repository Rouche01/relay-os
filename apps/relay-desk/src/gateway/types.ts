export interface DeskSettings {
  gatewayUrl: string;
  apiToken: string;
  jobId: string;
  agentId: string;
  ttlSec: number;
}

export interface ComputerLease {
  session_id: string;
  api_base?: string;
  vnc_url: string;
  expires_at?: string;
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
};
