/** Local Desk history of scaffolded Spec YAML (not the shell v1 compose store). */

export type SpecHistoryEntry = {
  id: string;
  at: string;
  mode?: string;
  intentPreview: string;
  yaml: string;
};

const KEY = "relay-desk.spec-v2-history";
const MAX = 8;

export function loadSpecHistory(): SpecHistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SpecHistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function pushSpecHistory(entry: Omit<SpecHistoryEntry, "id" | "at">): SpecHistoryEntry[] {
  const next: SpecHistoryEntry = {
    id: `hist_${Date.now().toString(36)}`,
    at: new Date().toISOString(),
    ...entry,
  };
  const list = [next, ...loadSpecHistory().filter((e) => e.yaml !== entry.yaml)].slice(
    0,
    MAX
  );
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* quota */
  }
  return list;
}

/** Very small line diff for stub vs LLM compare (not a full patch). */
export function lineDiff(
  left: string,
  right: string
): Array<{ kind: "same" | "del" | "add"; text: string }> {
  const a = left.split("\n");
  const b = right.split("\n");
  const out: Array<{ kind: "same" | "del" | "add"; text: string }> = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const L = a[i];
    const R = b[i];
    if (L === R) {
      if (L !== undefined) out.push({ kind: "same", text: L });
    } else {
      if (L !== undefined) out.push({ kind: "del", text: L });
      if (R !== undefined) out.push({ kind: "add", text: R });
    }
  }
  return out;
}

export function scaffoldPhaseLabel(elapsedSec: number): string {
  if (elapsedSec < 12) return "drafting…";
  if (elapsedSec < 35) return "repair / validate…";
  if (elapsedSec < 70) return "still generating…";
  return "taking longer than usual…";
}
