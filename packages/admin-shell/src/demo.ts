#!/usr/bin/env node
/**
 * Smoke entry: in-memory demo collection so the shell can be verified
 * without community-engager adapters.
 */
import { createAdminServer } from "./create-server.js";
import type {
  CollectionAdapter,
  GetResult,
  ListFilter,
  ListResult,
  SeriesPayload,
} from "./types.js";

type DemoRow = {
  id: string;
  status: string;
  label: string;
  updatedAt: string;
  value: number;
};

const rows: DemoRow[] = [
  {
    id: "demo-1",
    status: "open",
    label: "First sample",
    updatedAt: new Date(Date.now() - 3600_000).toISOString(),
    value: 3,
  },
  {
    id: "demo-2",
    status: "done",
    label: "Second sample",
    updatedAt: new Date().toISOString(),
    value: 7,
  },
];

const demoCollection: CollectionAdapter = {
  id: "demo",
  label: "Demo",
  source: { driver: "file", path: "(in-memory)" },
  capabilities: {
    list: true,
    get: true,
    patch: true,
    delete: true,
    actions: ["complete"],
    series: true,
  },
  async list(filter: ListFilter = {}): Promise<ListResult> {
    let out = [...rows].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    if (filter.status) out = out.filter((r) => r.status === filter.status);
    if (filter.limit !== undefined) out = out.slice(0, filter.limit);
    return {
      columns: [
        { key: "updatedAt", label: "Updated" },
        { key: "status", label: "Status" },
        { key: "label", label: "Label" },
        { key: "value", label: "Value" },
      ],
      rows: out.map((r) => ({ ...r })),
    };
  },
  async get(id: string): Promise<GetResult | null> {
    const row = rows.find((r) => r.id === id);
    if (!row) return null;
    return {
      record: { ...row },
      detail: {
        kind: "json",
        title: row.id,
        subtitle: row.label,
        editable: ["label", "value", "status"],
      },
    };
  },
  async patch(id: string, body: Record<string, unknown>): Promise<GetResult> {
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) throw new Error(`Not found: ${id}`);
    const prev = rows[idx]!;
    const next: DemoRow = {
      ...prev,
      label: body.label !== undefined ? String(body.label) : prev.label,
      status: body.status !== undefined ? String(body.status) : prev.status,
      value:
        body.value !== undefined && Number.isFinite(Number(body.value))
          ? Number(body.value)
          : prev.value,
      updatedAt: new Date().toISOString(),
    };
    rows[idx] = next;
    return (await this.get(id))!;
  },
  async delete(id: string): Promise<boolean> {
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) return false;
    rows.splice(idx, 1);
    return true;
  },
  async action(
    name: string,
    id: string,
    _body?: Record<string, unknown>
  ): Promise<GetResult> {
    if (name !== "complete") throw new Error(`Unknown action: ${name}`);
    return this.patch!(id, { status: "done" });
  },
  async series(query: ListFilter = {}): Promise<SeriesPayload> {
    let out = [...rows].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    if (query.limit !== undefined) out = out.slice(-query.limit);
    return {
      points: out.map((r) => ({
        t: r.updatedAt,
        runId: r.id,
        value: r.value,
      })),
    };
  },
};

async function main(): Promise<void> {
  const port = Number(process.env.ADMIN_PORT ?? "8799");
  await createAdminServer({
    title: "Relay admin shell (demo)",
    port,
    collections: [demoCollection],
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
