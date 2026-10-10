/**
 * Where a collection reads/writes. File now; postgres reserved for later drivers.
 * Each collection has its own source — paths need not share a data root.
 */
export type SourceConfig =
  | { driver: "file"; path: string }
  | { driver: "postgres"; connectionString: string; table?: string };

export interface CollectionCapabilities {
  list: true;
  get: true;
  patch?: boolean;
  delete?: boolean;
  /** Named side-effects, e.g. promote, reject, status */
  actions?: string[];
  /** Chronological metrics for charts */
  series?: boolean;
}

export interface ListColumn {
  key: string;
  label: string;
}

export interface ListFilter {
  status?: string;
  limit?: number;
  from?: string;
  to?: string;
  [key: string]: string | number | undefined;
}

export interface ListResult {
  rows: Record<string, unknown>[];
  columns: ListColumn[];
}

/** Hint for the SPA detail pane; unknown kinds fall back to raw JSON. */
export type DetailKind =
  | "json"
  | "action-draft"
  | "allowlist-entry"
  | "run-debug"
  | string;

/** Per-item investigation payload (e.g. run-debug charts). */
export interface RunDebugViz {
  stages: Array<{
    id: string;
    label: string;
    ok?: boolean;
    note?: string;
    waitMs?: number;
  }>;
  jobs: Array<{
    id: string;
    outcome: string;
    subreddit?: string;
    title?: string;
    error?: string;
    postedUrl?: string;
  }>;
  scout: {
    blockedCount: number;
    timedOutCount: number;
    listingOk?: boolean;
    subs: Array<{
      subreddit: string;
      status: string;
      opportunities: number;
      reason?: string;
    }>;
  };
  funnel: {
    scouted: number;
    jobs: number;
    approved: number;
    aborted: number;
    failed: number;
    posted: number;
  };
  durationMs?: number;
  runState?: string;
}

export interface GetResult {
  record: unknown;
  detail?: {
    kind?: DetailKind;
    title?: string;
    subtitle?: string;
    /** Editable field keys when patch is supported */
    editable?: string[];
    /** Present when kind is "run-debug" */
    viz?: RunDebugViz;
  };
}

export interface SeriesPoint {
  /** Primary time axis — usually endedAt */
  t: string;
  runId?: string;
  startedAt?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface SeriesPayload {
  points: SeriesPoint[];
  /** Optional aggregated funnel for the returned window */
  funnel?: {
    scouted: number;
    jobs: number;
    approved: number;
    aborted: number;
    failed: number;
    posted: number;
  };
}

/**
 * App-owned store plugin. The shell never imports domain types —
 * only this contract.
 */
export interface CollectionAdapter {
  id: string;
  label: string;
  source: SourceConfig;
  capabilities: CollectionCapabilities;
  list(filter?: ListFilter): Promise<ListResult>;
  get(id: string): Promise<GetResult | null>;
  patch?(id: string, body: Record<string, unknown>): Promise<GetResult>;
  delete?(id: string): Promise<boolean>;
  action?(
    name: string,
    id: string,
    body?: Record<string, unknown>
  ): Promise<GetResult>;
  series?(query?: ListFilter): Promise<SeriesPayload>;
}

export interface AdminServerOptions {
  /** Shown in the UI header */
  title?: string;
  collections: CollectionAdapter[];
  host?: string;
  port?: number;
  /** Override static asset root (default: package `public/`) */
  publicDir?: string;
}

export interface AdminServerHandle {
  host: string;
  port: number;
  url: string;
  close: () => Promise<void>;
}
