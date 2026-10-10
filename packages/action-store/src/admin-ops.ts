import type {
  ActionListFilter,
  ActionRecord,
  ActionStatus,
  ActionStore,
} from "./types.js";

const PROTECTED_RECORD_KEYS = new Set([
  "id",
  "appId",
  "createdAt",
  "updatedAt",
  "status",
]);

/** Payload-relative fields that use the HITL edit transition when pending. */
const LIFECYCLE_DRAFT_FIELDS = new Set(["draftText", "payload.draftText"]);

function normalizeField(field: string): string {
  return field.startsWith("payload.") ? field.slice("payload.".length) : field;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return raw;
    }
  }
  return raw;
}

export async function listActions(
  store: ActionStore,
  filter: ActionListFilter = {}
): Promise<ActionRecord[]> {
  return store.list(filter);
}

export async function getAction(
  store: ActionStore,
  id: string
): Promise<ActionRecord | null> {
  return store.get(id);
}

/**
 * Edit a payload field.
 * - pending_approval + draftText → updateStatus("edited") (HITL path)
 * - otherwise → put with shallow payload merge
 */
export async function editActionField(
  store: ActionStore,
  id: string,
  field: string,
  value: unknown
): Promise<ActionRecord> {
  if (PROTECTED_RECORD_KEYS.has(field) || field.startsWith("status")) {
    throw new Error(
      `Refusing to rewrite protected field "${field}" via edit; use status command`
    );
  }

  const current = await store.get(id);
  if (!current) {
    throw new Error(`Action not found: ${id}`);
  }

  const payloadKey = normalizeField(field);
  if (!payloadKey || payloadKey.includes(".")) {
    throw new Error(
      `Unsupported field path "${field}" — use a single payload key (e.g. draftText)`
    );
  }

  const resolved =
    typeof value === "string" ? parseValue(value) : value;

  if (
    payloadKey === "draftText" &&
    current.status === "pending_approval" &&
    (LIFECYCLE_DRAFT_FIELDS.has(field) || field === "draftText")
  ) {
    return store.updateStatus(id, "edited", {
      payload: {
        draftText: String(resolved),
        status: "edited",
      },
    });
  }

  const payload = isPlainObject(current.payload)
    ? { ...current.payload, [payloadKey]: resolved }
    : { [payloadKey]: resolved };

  const next: ActionRecord = {
    ...current,
    payload,
    updatedAt: new Date().toISOString(),
  };
  await store.put(next);
  return next;
}

export async function setActionStatus(
  store: ActionStore,
  id: string,
  status: ActionStatus,
  payloadPatch?: Record<string, unknown>
): Promise<ActionRecord> {
  return store.updateStatus(id, status, payloadPatch ? { payload: payloadPatch } : undefined);
}

export async function deleteAction(
  store: ActionStore,
  id: string
): Promise<boolean> {
  if (!store.delete) {
    throw new Error("This ActionStore driver does not support delete");
  }
  return store.delete(id);
}

export const ACTION_STATUSES: ActionStatus[] = [
  "proposed",
  "pending_approval",
  "approved",
  "edited",
  "aborted",
  "posted",
  "failed",
];

export function isActionStatus(value: string): value is ActionStatus {
  return (ACTION_STATUSES as string[]).includes(value);
}
