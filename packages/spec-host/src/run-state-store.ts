import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SpecHostError } from "./errors.js";
import {
  filterCheckpoints,
  SPEC_RUN_CHECKPOINT_VERSION,
  toRunSummary,
  type ListRunsQuery,
  type RunStateStore,
  type SpecRunCheckpoint,
  type SpecRunSummary,
} from "./checkpoint.js";

/** In-memory run store — tests and single-process Desk. */
export class MemoryRunStateStore implements RunStateStore {
  private readonly map = new Map<string, SpecRunCheckpoint>();

  async save(checkpoint: SpecRunCheckpoint): Promise<void> {
    this.map.set(checkpoint.runId, structuredClone(checkpoint));
  }

  async get(runId: string): Promise<SpecRunCheckpoint | undefined> {
    const c = this.map.get(runId);
    return c ? structuredClone(c) : undefined;
  }

  async list(): Promise<readonly SpecRunCheckpoint[]> {
    return [...this.map.values()].map((c) => structuredClone(c));
  }

  async delete(runId: string): Promise<void> {
    this.map.delete(runId);
  }

  async listBySpec(query: ListRunsQuery = {}): Promise<SpecRunCheckpoint[]> {
    return filterCheckpoints(await this.list(), query);
  }

  async listSummaries(query: ListRunsQuery = {}): Promise<SpecRunSummary[]> {
    return (await this.listBySpec(query)).map(toRunSummary);
  }
}

export function createMemoryRunStateStore(): MemoryRunStateStore {
  return new MemoryRunStateStore();
}

/** One JSON file per run under `dir`. */
export class FileRunStateStore implements RunStateStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  get directory(): string {
    return this.dir;
  }

  private pathFor(runId: string): string {
    const safe = runId.replace(/[^a-zA-Z0-9._-]/g, "_");
    return join(this.dir, `${safe}.json`);
  }

  async save(checkpoint: SpecRunCheckpoint): Promise<void> {
    writeFileSync(
      this.pathFor(checkpoint.runId),
      JSON.stringify(checkpoint, null, 2),
      "utf8"
    );
  }

  async get(runId: string): Promise<SpecRunCheckpoint | undefined> {
    try {
      const raw = readFileSync(this.pathFor(runId), "utf8");
      const parsed = JSON.parse(raw) as SpecRunCheckpoint;
      if (parsed.version !== SPEC_RUN_CHECKPOINT_VERSION) {
        throw new SpecHostError(
          "checkpoint_version",
          `Unsupported checkpoint version ${String(parsed.version)}`
        );
      }
      // Normalize older checkpoints missing createdAt/updatedAt.
      if (!parsed.updatedAt && parsed.savedAt) parsed.updatedAt = parsed.savedAt;
      if (!parsed.createdAt && parsed.savedAt) parsed.createdAt = parsed.savedAt;
      return parsed;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      if (err instanceof SpecHostError) throw err;
      throw new SpecHostError(
        "checkpoint_unreadable",
        `Cannot read run ${JSON.stringify(runId)}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  async list(): Promise<readonly SpecRunCheckpoint[]> {
    const out: SpecRunCheckpoint[] = [];
    for (const name of readdirSync(this.dir)) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -".json".length);
      const c = await this.get(id);
      if (c) out.push(c);
    }
    return out;
  }

  async delete(runId: string): Promise<void> {
    try {
      unlinkSync(this.pathFor(runId));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  async listBySpec(query: ListRunsQuery = {}): Promise<SpecRunCheckpoint[]> {
    return filterCheckpoints(await this.list(), query);
  }

  async listSummaries(query: ListRunsQuery = {}): Promise<SpecRunSummary[]> {
    return (await this.listBySpec(query)).map(toRunSummary);
  }
}

export function createFileRunStateStore(dir: string): FileRunStateStore {
  return new FileRunStateStore(dir);
}

/** Query any RunStateStore that implements list(). */
export async function listRuns(
  store: RunStateStore,
  query: ListRunsQuery = {}
): Promise<SpecRunCheckpoint[]> {
  if (!store.list) {
    throw new SpecHostError(
      "run_store_no_list",
      "RunStateStore does not implement list()"
    );
  }
  const all = await Promise.resolve(store.list());
  return filterCheckpoints(all, query);
}

export async function listRunSummaries(
  store: RunStateStore,
  query: ListRunsQuery = {}
): Promise<SpecRunSummary[]> {
  return (await listRuns(store, query)).map(toRunSummary);
}
