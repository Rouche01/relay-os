export interface DeskAdapterConfig {
  /** Bind host (default 127.0.0.1). */
  host?: string;
  /** HTTP port for Desk poll/respond (default 9100). */
  port?: number;
  /**
   * Optional Bearer token. When set, Desk must send
   * `Authorization: Bearer <token>`. Empty/undefined = open (local dogfood).
   */
  token?: string;
}

export type DeskAdapterEnv = {
  DESK_HITL_HOST?: string;
  DESK_HITL_PORT?: string;
  DESK_HITL_TOKEN?: string;
};
