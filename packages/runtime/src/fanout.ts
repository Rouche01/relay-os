import type {
  AgentContext,
  AgentState,
  StageDefinition,
} from "@relay/protocol";
import type { AppController } from "./types.js";
import type { AgentRuntime } from "./agent-runner.js";

/** Outcome of one child runtime in a fanout stage. */
export type FanoutChildOutcome =
  | "complete"
  | "aborted"
  | "failed"
  | "unknown";

export interface FanoutChildResult {
  index: number;
  /** `item.id` when the work item is an object with a string id. */
  itemId?: string;
  state: AgentState;
  outcome: FanoutChildOutcome;
  error?: string;
  hitlOutcome?: unknown;
  executeResult?: unknown;
}

export interface FanoutSummary {
  stage: string;
  total: number;
  processed: number;
  skipped: number;
  children: FanoutChildResult[];
  complete: number;
  aborted: number;
  failed: number;
}

/**
 * App-provided hooks so the runtime can spawn isolated child agents
 * without knowing domain controllers or feedback adapters.
 */
export interface FanoutHost {
  /** Build the AppController for one work item. */
  createChildController(
    stage: StageDefinition,
    item: unknown,
    index: number,
    getContext: () => AgentContext
  ): AppController | Promise<AppController>;

  /** Attach broker / listeners before the child starts. */
  onChildStart?(
    child: AgentRuntime,
    item: unknown,
    index: number
  ): void | Promise<void>;

  /** Detach broker / listeners after the child settles (always called). */
  onChildEnd?(
    child: AgentRuntime,
    item: unknown,
    index: number
  ): void | Promise<void>;

  /** Optional log label (e.g. `r/fashion · fx-color-season`). */
  describeItem?(item: unknown, index: number): string;

  /**
   * Override manifest `max` / `delay_ms` (e.g. from env or app options).
   * Returned fields merge over the stage fanout definition.
   */
  resolveFanoutConfig?(stage: StageDefinition): {
    max?: number;
    delayMs?: number;
  } | undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function itemIdOf(item: unknown): string | undefined {
  if (item && typeof item === "object" && "id" in item) {
    const id = (item as { id: unknown }).id;
    return typeof id === "string" ? id : undefined;
  }
  return undefined;
}

export function resolveFanoutOutcome(
  state: AgentState,
  hitlOutcome: unknown
): FanoutChildOutcome {
  if (state === "FAILED") return "failed";
  if (state === "ABORTED") return "aborted";
  if (state === "COMPLETE") return "complete";
  if (hitlOutcome === "aborted") return "aborted";
  return "unknown";
}

export function summarizeFanout(
  stage: string,
  total: number,
  children: FanoutChildResult[]
): FanoutSummary {
  return {
    stage,
    total,
    processed: children.length,
    skipped: Math.max(0, total - children.length),
    children,
    complete: children.filter((c) => c.outcome === "complete").length,
    aborted: children.filter((c) => c.outcome === "aborted").length,
    failed: children.filter((c) => c.outcome === "failed").length,
  };
}

export function formatFanoutSummary(summary: FanoutSummary): string {
  const lines = [
    `stage=${summary.stage} total=${summary.total} processed=${summary.processed} skipped=${summary.skipped}`,
    `complete=${summary.complete} aborted=${summary.aborted} failed=${summary.failed}`,
  ];
  for (const child of summary.children) {
    const id = child.itemId ?? `#${child.index + 1}`;
    const extra = child.error ? ` — ${child.error}` : "";
    lines.push(`  [${child.outcome}] ${id}${extra}`);
  }
  return lines.join("\n");
}

export { sleep as fanoutSleep };
