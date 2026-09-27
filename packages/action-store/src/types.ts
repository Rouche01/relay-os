/**
 * Shared HITL action lifecycle.
 * Apps own payload shape; the store owns status transitions.
 */
export type ActionStatus =
  | "proposed"
  | "pending_approval"
  | "approved"
  | "edited"
  | "aborted"
  | "posted"
  | "failed";

/** Durable record — driver-agnostic, JSON-serializable payload for Postgres jsonb later. */
export interface ActionRecord<TPayload = unknown> {
  id: string;
  /** Agentic app id, e.g. "community-engager" */
  appId: string;
  status: ActionStatus;
  /** App-owned domain object (draft, migration job, …) */
  payload: TPayload;
  createdAt: string;
  updatedAt: string;
}

export interface ActionListFilter {
  appId?: string;
  status?: ActionStatus | ActionStatus[];
  /** Inclusive ISO lower bound on updatedAt */
  updatedAfter?: string;
  limit?: number;
}

export interface ActionStatusPatch<TPayload = unknown> {
  /** Partial payload merge (shallow) when status changes, e.g. edited body */
  payload?: Partial<TPayload>;
}

/**
 * Persistence port for HITL action queues.
 * Apps depend on this interface only — never on file paths or SQL.
 *
 * Drivers: FileJsonActionStore (v1) → PostgresActionStore (later).
 */
export interface ActionStore {
  put<TPayload = unknown>(record: ActionRecord<TPayload>): Promise<void>;
  get<TPayload = unknown>(id: string): Promise<ActionRecord<TPayload> | null>;
  /**
   * Transition status with optional payload patch.
   * Throws if the transition is not allowed by the lifecycle.
   */
  updateStatus<TPayload = unknown>(
    id: string,
    status: ActionStatus,
    patch?: ActionStatusPatch<TPayload>
  ): Promise<ActionRecord<TPayload>>;
  list<TPayload = unknown>(filter?: ActionListFilter): Promise<ActionRecord<TPayload>[]>;
  delete?(id: string): Promise<boolean>;
}
