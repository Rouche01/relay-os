import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertTransition } from "./transitions.js";
import type {
  ActionListFilter,
  ActionRecord,
  ActionStatus,
  ActionStatusPatch,
  ActionStore,
} from "./types.js";

export interface FileJsonActionStoreOptions {
  /** Path to the JSON file (default: `.data/actions.json`). */
  filePath?: string;
}

type StoreFile = {
  version: 1;
  records: ActionRecord[];
};

/**
 * v1 local driver — single JSON file under `.data/`.
 * Same ActionStore contract as a future Postgres driver.
 */
export class FileJsonActionStore implements ActionStore {
  private readonly filePath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(options: FileJsonActionStoreOptions = {}) {
    this.filePath = path.resolve(options.filePath ?? ".data/actions.json");
  }

  async put<TPayload = unknown>(record: ActionRecord<TPayload>): Promise<void> {
    await this.mutate((records) => {
      const idx = records.findIndex((r) => r.id === record.id);
      const next = record as ActionRecord;
      if (idx >= 0) {
        records[idx] = next;
      } else {
        records.push(next);
      }
    });
  }

  async get<TPayload = unknown>(id: string): Promise<ActionRecord<TPayload> | null> {
    const { records } = await this.read();
    const found = records.find((r) => r.id === id);
    return (found as ActionRecord<TPayload>) ?? null;
  }

  async updateStatus<TPayload = unknown>(
    id: string,
    status: ActionStatus,
    patch?: ActionStatusPatch<TPayload>
  ): Promise<ActionRecord<TPayload>> {
    let updated: ActionRecord<TPayload> | null = null;

    await this.mutate((records) => {
      const idx = records.findIndex((r) => r.id === id);
      if (idx < 0) {
        throw new Error(`Action not found: ${id}`);
      }
      const current = records[idx] as ActionRecord<TPayload>;
      assertTransition(current.status, status);

      const now = new Date().toISOString();
      const payload =
        patch?.payload !== undefined
          ? ({
              ...(current.payload as object),
              ...(patch.payload as object),
            } as TPayload)
          : current.payload;

      updated = {
        ...current,
        status,
        payload,
        updatedAt: now,
      };
      records[idx] = updated as ActionRecord;
    });

    if (!updated) {
      throw new Error(`Action not found: ${id}`);
    }
    return updated;
  }

  async list<TPayload = unknown>(
    filter: ActionListFilter = {}
  ): Promise<ActionRecord<TPayload>[]> {
    const { records } = await this.read();
    let result = records as ActionRecord<TPayload>[];

    if (filter.appId) {
      result = result.filter((r) => r.appId === filter.appId);
    }
    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      result = result.filter((r) => statuses.includes(r.status));
    }
    if (filter.updatedAfter) {
      result = result.filter((r) => r.updatedAt >= filter.updatedAfter!);
    }

    result = [...result].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

    if (filter.limit !== undefined && filter.limit >= 0) {
      result = result.slice(0, filter.limit);
    }

    return result;
  }

  async delete(id: string): Promise<boolean> {
    let removed = false;
    await this.mutate((records) => {
      const idx = records.findIndex((r) => r.id === id);
      if (idx >= 0) {
        records.splice(idx, 1);
        removed = true;
      }
    });
    return removed;
  }

  private async read(): Promise<StoreFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as StoreFile;
      if (!parsed || !Array.isArray(parsed.records)) {
        return { version: 1, records: [] };
      }
      return { version: 1, records: parsed.records };
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        return { version: 1, records: [] };
      }
      throw err;
    }
  }

  /** Serialize writes so concurrent updates don't clobber each other. */
  private mutate(fn: (records: ActionRecord[]) => void): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      const data = await this.read();
      fn(data.records);
      await this.write(data);
    });
    return this.writeChain;
  }

  private async write(data: StoreFile): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const body = JSON.stringify({ version: 1, records: data.records }, null, 2);
    await writeFile(tmp, body, "utf8");
    await rename(tmp, this.filePath);
  }
}

/** Helper to create a new record with timestamps. */
export function createActionRecord<TPayload>(
  input: Omit<ActionRecord<TPayload>, "createdAt" | "updatedAt"> & {
    createdAt?: string;
    updatedAt?: string;
  }
): ActionRecord<TPayload> {
  const now = new Date().toISOString();
  return {
    ...input,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}
