import type { EngineAction } from "@relay/protocol";

/** Body forwarded to Computer Runtime POST .../action (desktop + phone). */
export interface ComputerActionPayload {
  type: string;
  x?: number;
  y?: number;
  /** swipe start / end (phone) */
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  text?: string;
  direction?: string;
  amount?: number;
  /** swipe / long_press duration (phone) */
  duration_ms?: number;
  /** launch — Android package name */
  package?: string;
  /** launch — optional am-start uri (http(s) or intent) */
  uri?: string;
  /** tap / long_press by observe element ref (phone) */
  ref?: string;
}

/** One UIAutomator element from GET .../observe (phone). */
export interface ComputerObserveElement {
  ref?: string;
  text?: string;
  content_desc?: string;
  bounds?: string | number[];
  center?: { x: number; y: number } | [number, number];
  clickable?: boolean;
  [key: string]: unknown;
}

/** Result data from execute type=observe (phone seats). */
export interface ComputerObserveResult {
  image?: string;
  elements?: ComputerObserveElement[];
  geometry?: { width: number; height: number };
  element_count?: number;
  ok?: boolean;
}

/** Gateway seat kind — omit / desktop preserves existing desktop-only callers. */
export type ComputerSeatKind = "desktop" | "phone";

export interface ComputerLeaseParams {
  agent_id?: string;
  job_id?: string;
  ttl_sec?: number;
  /** Seat kind for POST /v1/sessions. Omit for gateway default (desktop). */
  kind?: ComputerSeatKind;
}

export interface ComputerActionParams {
  /** lease / acquire / heartbeat */
  agent_id?: string;
  job_id?: string;
  ttl_sec?: number;
  /** lease — seat kind (`desktop` | `phone`); omit = desktop */
  kind?: ComputerSeatKind;
  /**
   * acquire — session to reattach (default: last soft-parked session on this engine).
   */
  session_id?: string;
  /** action — forwarded to gateway */
  action?: ComputerActionPayload;
  /** observe — cap on UIAutomator elements (gateway default 200, max 500) */
  max_elements?: number;
}

/**
 * Gateway session actions.
 *
 * - `release` — soft **park** (DELETE /v1/sessions/{id}): drop claim, keep Firefox warm
 * - `recycle` — wipe Firefox and free the worker (DELETE …?recycle=true)
 * - `acquire` — re-lease a parked desktop by session_id
 * - `lease` with the same `job_id` also reattaches a parked slot (gateway-side)
 * - `observe` — phone: screenshot + UIAutomator elements (desktop workers return 404)
 */
export type ComputerActionType =
  | "lease"
  | "acquire"
  | "screenshot"
  | "observe"
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
  /** Seat kind from gateway when present (`desktop` | `phone`). */
  kind?: ComputerSeatKind | null;
  /** Inventory seat id from gateway when present. */
  seat_id?: string | null;
}

/** One row from GET /v1/seats. */
export interface GatewaySeat {
  id: string;
  kind?: ComputerSeatKind | string | null;
  state?: "free" | "leased" | "parked" | string | null;
  session_id?: string | null;
  vnc_url?: string | null;
  job_id?: string | null;
  agent_id?: string | null;
  worker_base_url?: string | null;
  expires_at?: string | null;
  parked_at?: string | null;
}
