import type {
  CollectionAdapter,
  GetResult,
  ListFilter,
  ListResult,
  SourceConfig,
} from "@relay/admin-shell";
import {
  deleteAction,
  editActionField,
  getAction,
  isActionStatus,
  listActions,
  setActionStatus,
} from "./admin-ops.js";
import type { ActionRecord, ActionStatus, ActionStore } from "./types.js";

function payloadOf(record: ActionRecord): Record<string, unknown> {
  return record.payload &&
    typeof record.payload === "object" &&
    !Array.isArray(record.payload)
    ? (record.payload as Record<string, unknown>)
    : {};
}

function previewText(record: ActionRecord): string {
  const text = payloadOf(record).draftText;
  if (typeof text !== "string") return "—";
  return text.replace(/\s+/g, " ").trim().slice(0, 80) || "—";
}

function toGetResult(record: ActionRecord): GetResult {
  const p = payloadOf(record);
  const sub = typeof p.subreddit === "string" ? `r/${p.subreddit}` : record.appId;
  return {
    record,
    detail: {
      kind: "action-draft",
      title: record.id,
      subtitle: `${sub} · ${record.status}`,
      editable: ["draftText"],
    },
  };
}

export interface ActionStoreCollectionOptions {
  id?: string;
  label?: string;
}

/**
 * Admin-shell collection over an ActionStore port.
 * Source is informational (path / future postgres DSN) — the store is already open.
 */
export function createActionStoreCollection(
  store: ActionStore,
  source: SourceConfig,
  options: ActionStoreCollectionOptions = {}
): CollectionAdapter {
  const id = options.id ?? "actions";
  const label = options.label ?? "Actions";

  return {
    id,
    label,
    source,
    capabilities: {
      list: true,
      get: true,
      patch: true,
      delete: true,
      actions: ["status"],
    },

    async list(filter: ListFilter = {}): Promise<ListResult> {
      const status =
        typeof filter.status === "string" && isActionStatus(filter.status)
          ? filter.status
          : undefined;
      const limit =
        typeof filter.limit === "number" && Number.isFinite(filter.limit)
          ? filter.limit
          : undefined;
      const records = await listActions(store, { status, limit });
      return {
        columns: [
          { key: "updatedAt", label: "Updated" },
          { key: "status", label: "Status" },
          { key: "subreddit", label: "Sub" },
          { key: "preview", label: "Preview" },
        ],
        rows: records.map((r) => {
          const p = payloadOf(r);
          return {
            id: r.id,
            updatedAt: r.updatedAt,
            status: r.status,
            subreddit:
              typeof p.subreddit === "string" ? `r/${p.subreddit}` : "—",
            preview: previewText(r),
          };
        }),
      };
    },

    async get(itemId: string): Promise<GetResult | null> {
      const record = await getAction(store, itemId);
      return record ? toGetResult(record) : null;
    },

    async patch(
      itemId: string,
      body: Record<string, unknown>
    ): Promise<GetResult> {
      if (body.draftText !== undefined) {
        await editActionField(store, itemId, "draftText", body.draftText);
      }
      for (const [key, value] of Object.entries(body)) {
        if (key === "draftText" || key === "status" || key === "field") continue;
        await editActionField(store, itemId, key, value);
      }
      // Legacy shape from older clients
      if (typeof body.field === "string") {
        await editActionField(store, itemId, body.field, body.value);
      }
      const record = await getAction(store, itemId);
      if (!record) throw new Error(`Action not found: ${itemId}`);
      return toGetResult(record);
    },

    async delete(itemId: string): Promise<boolean> {
      return deleteAction(store, itemId);
    },

    async action(
      name: string,
      itemId: string,
      body: Record<string, unknown> = {}
    ): Promise<GetResult> {
      if (name !== "status") {
        throw new Error(`Unknown action: ${name}`);
      }
      const next = body.status;
      if (typeof next !== "string" || !isActionStatus(next)) {
        throw new Error("action status requires body.status ActionStatus");
      }
      await setActionStatus(store, itemId, next as ActionStatus);
      const record = await getAction(store, itemId);
      if (!record) throw new Error(`Action not found: ${itemId}`);
      return toGetResult(record);
    },
  };
}

/** Resolve SourceConfig for the file driver from env. */
export function actionStoreSourceFromEnv(
  env: NodeJS.ProcessEnv = process.env
): SourceConfig {
  const driver = (env.ACTION_STORE ?? "file").toLowerCase();
  if (driver === "postgres") {
    const connectionString =
      env.ACTION_STORE_DATABASE_URL ?? env.DATABASE_URL ?? "";
    return {
      driver: "postgres",
      connectionString,
      table: env.ACTION_STORE_TABLE,
    };
  }
  return {
    driver: "file",
    path: env.ACTION_STORE_PATH?.trim() || ".data/actions.json",
  };
}
