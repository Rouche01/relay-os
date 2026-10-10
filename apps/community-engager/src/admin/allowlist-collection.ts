import type {
  CollectionAdapter,
  GetResult,
  ListFilter,
  ListResult,
  SourceConfig,
} from "@relay/admin-shell";
import {
  AllowlistStore,
  type AllowlistEntry,
  type AllowlistStatus,
} from "../allowlist-store.js";
import { assertFileSource } from "./sources.js";

const STATUSES: AllowlistStatus[] = ["postable", "proposed", "rejected"];

function isStatus(v: string): v is AllowlistStatus {
  return (STATUSES as string[]).includes(v);
}

function toGet(entry: AllowlistEntry): GetResult {
  return {
    record: entry,
    detail: {
      kind: "allowlist-entry",
      title: `r/${entry.name}`,
      subtitle: `${entry.source} · ${entry.status}`,
      editable: ["note", "score", "rulesOk", "status", "evidence"],
    },
  };
}

export function createAllowlistCollection(
  source: SourceConfig
): CollectionAdapter {
  assertFileSource(source, "allowlist");
  const store = new AllowlistStore(source.path);

  return {
    id: "allowlist",
    label: "Allowlist",
    source,
    capabilities: {
      list: true,
      get: true,
      patch: true,
      actions: ["promote", "reject"],
    },

    async list(filter: ListFilter = {}): Promise<ListResult> {
      let entries = await store.load();
      entries = [...entries].sort((a, b) =>
        a.updatedAt < b.updatedAt ? 1 : -1
      );
      if (typeof filter.status === "string" && isStatus(filter.status)) {
        entries = entries.filter((e) => e.status === filter.status);
      }
      if (typeof filter.limit === "number" && filter.limit >= 0) {
        entries = entries.slice(0, filter.limit);
      }
      return {
        columns: [
          { key: "updatedAt", label: "Updated" },
          { key: "status", label: "Status" },
          { key: "name", label: "Sub" },
          { key: "score", label: "Score" },
          { key: "note", label: "Note" },
        ],
        rows: entries.map((e) => ({
          id: e.name,
          name: e.name,
          updatedAt: e.updatedAt,
          status: e.status,
          score: e.score,
          note: (e.note || "").slice(0, 60) || "—",
        })),
      };
    },

    async get(id: string): Promise<GetResult | null> {
      const entry = await store.get(id);
      return entry ? toGet(entry) : null;
    },

    async patch(
      id: string,
      body: Record<string, unknown>
    ): Promise<GetResult> {
      const patch: Parameters<AllowlistStore["patch"]>[1] = {};
      if (body.note !== undefined) patch.note = String(body.note);
      if (body.evidence !== undefined) patch.evidence = String(body.evidence);
      if (body.score !== undefined) patch.score = Number(body.score);
      if (body.rulesOk !== undefined) patch.rulesOk = Boolean(body.rulesOk);
      if (typeof body.status === "string") {
        if (!isStatus(body.status)) {
          throw new Error(`Invalid allowlist status: ${body.status}`);
        }
        patch.status = body.status;
      }
      const entry = await store.patch(id, patch);
      if (!entry) throw new Error(`Allowlist entry not found: ${id}`);
      return toGet(entry);
    },

    async action(
      name: string,
      id: string,
      body: Record<string, unknown> = {}
    ): Promise<GetResult> {
      if (name === "promote") {
        const note =
          typeof body.note === "string" ? body.note : undefined;
        const entry = await store.promote(id, note);
        if (!entry) throw new Error(`Promote failed: ${id}`);
        return toGet(entry);
      }
      if (name === "reject") {
        await store.reject(id);
        const entry = await store.get(id);
        if (!entry) throw new Error(`Allowlist entry not found: ${id}`);
        return toGet(entry);
      }
      throw new Error(`Unknown action: ${name}`);
    },
  };
}
