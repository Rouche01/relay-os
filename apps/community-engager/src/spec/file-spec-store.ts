import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  SpecBundle,
  SpecListFilter,
  SpecStore,
} from "@relay/protocol";

export type FileJsonSpecStoreOptions = {
  /** Path to the JSON file (default: `.data/specs.json`). */
  filePath?: string;
};

type StoreFile = {
  version: 1;
  records: SpecBundle[];
};

/**
 * v1 local SpecStore — single JSON file under dataDir.
 * Same contract as a future Postgres / action-store sibling driver.
 */
export class FileJsonSpecStore implements SpecStore {
  private readonly filePath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(options: FileJsonSpecStoreOptions = {}) {
    this.filePath = path.resolve(options.filePath ?? ".data/specs.json");
  }

  get path(): string {
    return this.filePath;
  }

  async put(bundle: SpecBundle): Promise<void> {
    const next: SpecBundle = {
      ...bundle,
      id: bundle.spec.id,
      savedAt: new Date().toISOString(),
    };
    await this.mutate((records) => {
      const idx = records.findIndex((r) => r.id === next.id);
      if (idx >= 0) {
        records[idx] = next;
      } else {
        records.push(next);
      }
    });
  }

  async get(id: string): Promise<SpecBundle | null> {
    const { records } = await this.read();
    return records.find((r) => r.id === id) ?? null;
  }

  async getByIntentId(intentId: string): Promise<SpecBundle | null> {
    const { records } = await this.read();
    const matches = records.filter((r) => r.intent.id === intentId);
    if (!matches.length) return null;
    return [...matches].sort((a, b) =>
      a.savedAt < b.savedAt ? 1 : -1
    )[0]!;
  }

  async list(filter: SpecListFilter = {}): Promise<SpecBundle[]> {
    const { records } = await this.read();
    let result = [...records];

    if (filter.appId) {
      result = result.filter((r) => r.appId === filter.appId);
    }
    if (filter.savedAfter) {
      result = result.filter((r) => r.savedAt >= filter.savedAfter!);
    }

    result.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));

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

  private mutate(fn: (records: SpecBundle[]) => void): Promise<void> {
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
    const body = JSON.stringify(
      { version: 1, records: data.records },
      null,
      2
    );
    await writeFile(tmp, body, "utf8");
    await rename(tmp, this.filePath);
  }
}

/** Default Spec store under CommunityEngager dataDir (`{dataDir}/specs.json`). */
export function createFileSpecStore(dataDir: string): FileJsonSpecStore {
  return new FileJsonSpecStore({
    filePath: path.join(path.resolve(dataDir), "specs.json"),
  });
}
