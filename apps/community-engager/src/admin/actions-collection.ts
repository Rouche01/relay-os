/**
 * CommunityEngager Actions admin collection:
 * editable draftText + postedUrl; mark_posted enrolls post-watch.
 */
import type {
  CollectionAdapter,
  GetResult,
  ListFilter,
  ListResult,
  SourceConfig,
} from "@relay/admin-shell";
import type { ActionRecord, ActionStatus, ActionStore } from "@relay/action-store";
import {
  deleteAction,
  editActionField,
  getAction,
  isActionStatus,
  listActions,
  setActionStatus,
} from "@relay/action-store";
import { markActionPostedAndWatch } from "./mark-posted.js";

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

/**
 * Flatten payload fields the SPA edits onto the record view so inputs prefill.
 * Raw store shape remains under payload.
 */
function toGetResult(record: ActionRecord): GetResult {
  const p = payloadOf(record);
  const sub = typeof p.subreddit === "string" ? `r/${p.subreddit}` : record.appId;
  const postedUrl = typeof p.postedUrl === "string" ? p.postedUrl : "";
  const draftText = typeof p.draftText === "string" ? p.draftText : "";
  return {
    record: {
      ...record,
      draftText,
      postedUrl,
    },
    detail: {
      kind: "action-draft",
      title: record.id,
      subtitle: `${sub} · ${record.status}${postedUrl ? " · has comment URL" : ""}`,
      editable: ["draftText", "postedUrl"],
    },
  };
}

export function createCommunityActionsCollection(
  store: ActionStore,
  source: SourceConfig
): CollectionAdapter {
  return {
    id: "actions",
    label: "Actions",
    source,
    capabilities: {
      list: true,
      get: true,
      patch: true,
      delete: true,
      actions: ["status", "mark_posted"],
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
      if (body.postedUrl !== undefined) {
        await editActionField(store, itemId, "postedUrl", String(body.postedUrl).trim());
      }
      for (const [key, value] of Object.entries(body)) {
        if (
          key === "draftText" ||
          key === "postedUrl" ||
          key === "status" ||
          key === "field"
        ) {
          continue;
        }
        await editActionField(store, itemId, key, value);
      }
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
      if (name === "status") {
        const next = body.status;
        if (typeof next !== "string" || !isActionStatus(next)) {
          throw new Error("action status requires body.status ActionStatus");
        }
        await setActionStatus(store, itemId, next as ActionStatus);
        const record = await getAction(store, itemId);
        if (!record) throw new Error(`Action not found: ${itemId}`);
        return toGetResult(record);
      }

      if (name === "mark_posted") {
        const existing = await getAction(store, itemId);
        if (!existing) throw new Error(`Action not found: ${itemId}`);
        const p = payloadOf(existing);
        const fromBody =
          typeof body.postedUrl === "string" ? body.postedUrl.trim() : "";
        const fromPayload =
          typeof p.postedUrl === "string" ? p.postedUrl.trim() : "";
        const postedUrl = fromBody || fromPayload;
        if (!postedUrl) {
          throw new Error(
            "mark_posted needs postedUrl — paste the comment permalink in postedUrl (Save) or in the prompt"
          );
        }
        const result = await markActionPostedAndWatch(store, itemId, {
          postedUrl,
        });
        const get = toGetResult(result.record);
        return {
          ...get,
          detail: {
            ...get.detail,
            subtitle:
              `${get.detail?.subtitle ?? ""} · watch ${result.watchId} firstLook=${result.checkAfter}`.trim(),
          },
        };
      }

      throw new Error(`Unknown action: ${name}`);
    },
  };
}
