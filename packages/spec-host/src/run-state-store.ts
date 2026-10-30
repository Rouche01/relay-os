import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SpecHostError } from "./errors.js";
import type { RunStateStore, SpecRunCheckpoint } from "./checkpoint.js";
import { SPEC_RUN_CHECKPOINT_VERSION } from "./checkpoint.js";

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
}

export function createMemoryRunStateStore(): MemoryRunStateStore {
  return new MemoryRunStateStore();
}

/** One JSON file per run under `dir`. */
export class FileRunStateStore implements RunStateStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
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
}

export function createFileRunStateStore(dir: string): FileRunStateStore {
  return new FileRunStateStore(dir);
}
