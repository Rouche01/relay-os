/**
 * Desk-local draft store for Build library (D2).
 * Drafts live on this Desk only — not server-persisted.
 * Migrates legacy `relay-desk.spec-v2-history` entries once.
 */

import { loadSpecHistory, type SpecHistoryEntry } from "../spec/history.ts";

export type DraftStatus =
  | "draft"
  | "checks_passed"
  | "frozen"
  | "needs_catalog";

export type DraftRecord = {
  id: string;
  /** Human title — usually Spec goal or first intent line. */
  goal: string;
  intent: string;
  yaml: string;
  status: DraftStatus;
  updatedAt: string;
  mode?: string;
  /** Frozen Spec id when status is frozen (local only until install). */
  frozenId?: string;
  /** Parsed Spec body from scaffold/validate (D4 — schematic source). */
  body?: Record<string, unknown>;
  /** Lowered manifest JSON when available (Design Manifest toggle). */
  manifest?: Record<string, unknown>;
};

const KEY = "relay-desk.build-drafts";
const LEGACY_MIGRATED = "relay-desk.build-drafts-migrated-v1";
const MAX = 48;

function goalFromYamlOrIntent(yaml: string, intent: string): string {
  const m = yaml.match(/^\s*goal:\s*(.+)\s*$/m);
  if (m?.[1]) {
    return m[1].replace(/^["']|["']$/g, "").trim().slice(0, 120) || "Untitled draft";
  }
  const line = intent.trim().split(/\n/)[0]?.trim() ?? "";
  return line.slice(0, 80) || "Untitled draft";
}

function fromHistory(entry: SpecHistoryEntry): DraftRecord {
  const intent = entry.intentPreview?.trim() || "";
  return {
    id: entry.id.startsWith("hist_") ? `draft_${entry.id.slice(5)}` : `draft_${entry.id}`,
    goal: goalFromYamlOrIntent(entry.yaml, intent),
    intent,
    yaml: entry.yaml,
    status: "draft",
    updatedAt: entry.at,
    mode: entry.mode,
  };
}

export function loadDrafts(): DraftRecord[] {
  try {
    migrateLegacyHistoryOnce();
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DraftRecord[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((d) => d && typeof d.id === "string" && typeof d.yaml === "string")
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  } catch {
    return [];
  }
}

function saveAll(list: DraftRecord[]): DraftRecord[] {
  const capped = list
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(capped));
  } catch {
    /* quota */
  }
  return capped;
}

function migrateLegacyHistoryOnce(): void {
  try {
    if (localStorage.getItem(LEGACY_MIGRATED) === "1") return;
    const existing = localStorage.getItem(KEY);
    const current: DraftRecord[] = existing
      ? ((JSON.parse(existing) as DraftRecord[]) ?? [])
      : [];
    const hist = loadSpecHistory();
    if (hist.length === 0) {
      localStorage.setItem(LEGACY_MIGRATED, "1");
      return;
    }
    const byYaml = new Set(current.map((d) => d.yaml));
    const migrated = hist
      .map(fromHistory)
      .filter((d) => d.yaml.trim() && !byYaml.has(d.yaml));
    if (migrated.length) saveAll([...migrated, ...current]);
    localStorage.setItem(LEGACY_MIGRATED, "1");
  } catch {
    /* ignore */
  }
}

export function getDraft(id: string): DraftRecord | undefined {
  return loadDrafts().find((d) => d.id === id);
}

export function upsertDraft(
  input: Omit<DraftRecord, "id" | "updatedAt" | "goal"> & {
    id?: string;
    goal?: string;
  }
): DraftRecord {
  const list = loadDrafts();
  const id = input.id ?? `draft_${Date.now().toString(36)}`;
  const goal =
    input.goal?.trim() ||
    goalFromYamlOrIntent(input.yaml, input.intent);
  const next: DraftRecord = {
    id,
    goal,
    intent: input.intent,
    yaml: input.yaml,
    status: input.status,
    updatedAt: new Date().toISOString(),
    mode: input.mode,
    frozenId: input.frozenId,
    body: input.body,
    manifest: input.manifest,
  };
  const without = list.filter((d) => d.id !== id && d.yaml !== input.yaml);
  saveAll([next, ...without]);
  return next;
}

export function updateDraft(
  id: string,
  patch: Partial<Omit<DraftRecord, "id">>
): DraftRecord | undefined {
  const list = loadDrafts();
  const idx = list.findIndex((d) => d.id === id);
  if (idx < 0) return undefined;
  const cur = list[idx]!;
  const next: DraftRecord = {
    ...cur,
    ...patch,
    id: cur.id,
    updatedAt: new Date().toISOString(),
  };
  list[idx] = next;
  saveAll(list);
  return next;
}

export function deleteDraft(id: string): void {
  saveAll(loadDrafts().filter((d) => d.id !== id));
}

/** Create a draft from pasted Spec YAML (secondary Build door). */
export function createDraftFromYaml(yaml: string, intent = ""): DraftRecord {
  return upsertDraft({
    intent: intent.trim() || "Pasted YAML",
    yaml: yaml.trim(),
    status: "draft",
  });
}
