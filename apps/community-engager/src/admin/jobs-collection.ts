import { readdir, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type {
  CollectionAdapter,
  GetResult,
  ListFilter,
  ListResult,
  SourceConfig,
} from "@relay/admin-shell";
import { assertFileSource } from "./sources.js";

async function listJsonFiles(
  dir: string,
  limit?: number
): Promise<{ name: string; mtimeMs: number }[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw err;
  }
  const rows: { name: string; mtimeMs: number }[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const st = await stat(path.join(dir, name));
    rows.push({ name, mtimeMs: st.mtimeMs });
  }
  rows.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (limit !== undefined && limit >= 0) return rows.slice(0, limit);
  return rows;
}

function preview(data: Record<string, unknown>): string {
  const log = typeof data.log === "string" ? data.log : "";
  const err = typeof data.error === "string" ? data.error : "";
  return (err || log).replace(/\s+/g, " ").trim().slice(0, 100) || "—";
}

export function createJobsCollection(source: SourceConfig): CollectionAdapter {
  assertFileSource(source, "jobs");
  const dir = source.path;

  return {
    id: "jobs",
    label: "Jobs",
    source,
    capabilities: {
      list: true,
      get: true,
      delete: true,
    },

    async list(filter: ListFilter = {}): Promise<ListResult> {
      const limit =
        typeof filter.limit === "number" ? filter.limit : undefined;
      const files = await listJsonFiles(dir, limit);
      const rows: Record<string, unknown>[] = [];
      for (const f of files) {
        const id = f.name.replace(/\.json$/, "");
        try {
          const raw = await readFile(path.join(dir, f.name), "utf8");
          const data = JSON.parse(raw) as Record<string, unknown>;
          rows.push({
            id,
            updatedAt: new Date(f.mtimeMs).toISOString(),
            ok: data.ok === true ? "ok" : data.ok === false ? "fail" : "—",
            transport: data.transport ?? "—",
            preview: preview(data),
          });
        } catch {
          rows.push({
            id,
            updatedAt: new Date(f.mtimeMs).toISOString(),
            ok: "—",
            transport: "—",
            preview: "(unreadable)",
          });
        }
      }
      return {
        columns: [
          { key: "updatedAt", label: "Updated" },
          { key: "ok", label: "OK" },
          { key: "transport", label: "Transport" },
          { key: "preview", label: "Preview" },
        ],
        rows,
      };
    },

    async get(id: string): Promise<GetResult | null> {
      const file = id.endsWith(".json") ? id : `${id}.json`;
      const safe = path.basename(file);
      try {
        const raw = await readFile(path.join(dir, safe), "utf8");
        const record = JSON.parse(raw) as Record<string, unknown>;
        return {
          record,
          detail: {
            kind: "json",
            title: String(record.jobId ?? safe),
            subtitle: safe,
          },
        };
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
        throw err;
      }
    },

    async delete(id: string): Promise<boolean> {
      const file = id.endsWith(".json") ? id : `${id}.json`;
      const safe = path.basename(file);
      try {
        await unlink(path.join(dir, safe));
        return true;
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return false;
        throw err;
      }
    },
  };
}
