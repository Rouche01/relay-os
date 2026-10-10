import fs from "node:fs/promises";
import path from "node:path";
import {
  ALLOWLISTED_SUBREDDITS,
  getRedditEnv,
  type SubredditPolicy,
} from "./reddit/config.js";

export type AllowlistSource = "seed" | "discovered";
export type AllowlistStatus = "postable" | "proposed" | "rejected";

export interface AllowlistEntry {
  name: string;
  rulesOk: boolean;
  note: string;
  source: AllowlistSource;
  status: AllowlistStatus;
  /** Higher = prefer when scouting (outcome-weighted). */
  score: number;
  approvedCount: number;
  abortedCount: number;
  evidence?: string;
  updatedAt: string;
  /**
   * Last time this sub was selected for a scout run.
   * Used for rotation (not demotion) so high-score subs do not monopolize.
   */
  lastScoutedAt?: string;
}

interface AllowlistFile {
  version: 1;
  entries: AllowlistEntry[];
}

function normalizeSub(name: string): string {
  return name.replace(/^r\//i, "").trim();
}

const MS_PER_DAY = 86_400_000;

/**
 * Whether an allowlist row should be excluded from discover research.
 * - postable / rejected: always
 * - proposed: excluded while updatedAt is within requeueDays (0 = always)
 */
export function isExcludedFromDiscover(
  entry: Pick<AllowlistEntry, "status" | "updatedAt">,
  opts: { requeueDays: number; now?: Date }
): boolean {
  if (entry.status === "postable" || entry.status === "rejected") return true;
  if (entry.status !== "proposed") return false;

  const days = Number.isFinite(opts.requeueDays)
    ? Math.max(0, Math.floor(opts.requeueDays))
    : 14;
  if (days === 0) return true;

  const nowMs = opts.now?.getTime() ?? Date.now();
  const updatedMs = Date.parse(entry.updatedAt);
  if (!Number.isFinite(updatedMs)) return true;
  return nowMs - updatedMs < days * MS_PER_DAY;
}

/** Sub names to pass as Reddit search `exclude`. */
export function discoverExcludeNames(
  entries: ReadonlyArray<Pick<AllowlistEntry, "name" | "status" | "updatedAt">>,
  opts: { requeueDays: number; now?: Date }
): string[] {
  return entries
    .filter((e) => isExcludedFromDiscover(e, opts))
    .map((e) => e.name);
}

type ScoutRankFields = Pick<
  AllowlistEntry,
  "score" | "approvedCount" | "updatedAt" | "lastScoutedAt"
>;

/**
 * Scout pick order: least-recently scouted first (never = oldest),
 * then score / approvals / updatedAt. Score is never lowered.
 */
export function compareScoutPriority(a: ScoutRankFields, b: ScoutRankFields): number {
  const aT = a.lastScoutedAt ? Date.parse(a.lastScoutedAt) : Number.NEGATIVE_INFINITY;
  const bT = b.lastScoutedAt ? Date.parse(b.lastScoutedAt) : Number.NEGATIVE_INFINITY;
  const aOk = Number.isFinite(aT) ? aT : Number.NEGATIVE_INFINITY;
  const bOk = Number.isFinite(bT) ? bT : Number.NEGATIVE_INFINITY;
  if (aOk !== bOk) return aOk - bOk;
  if (b.score !== a.score) return b.score - a.score;
  if (b.approvedCount !== a.approvedCount) {
    return b.approvedCount - a.approvedCount;
  }
  return b.updatedAt.localeCompare(a.updatedAt);
}

function seedEntry(policy: SubredditPolicy): AllowlistEntry {
  return {
    name: policy.name,
    rulesOk: policy.rulesOk,
    note: policy.note,
    source: "seed",
    status: policy.rulesOk ? "postable" : "rejected",
    score: policy.rulesOk ? 10 : 0,
    approvedCount: 0,
    abortedCount: 0,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Durable postable-sub allowlist (write gate).
 * VoltMem gets mirrored facts; this file is what scout reads.
 */
export class AllowlistStore {
  private readonly filePath: string;

  constructor(filePath?: string) {
    const cfg = getRedditEnv();
    this.filePath =
      filePath ?? path.join(cfg.dataDir, "allowlist", "subreddits.json");
  }

  async load(): Promise<AllowlistEntry[]> {
    const file = await this.readFile();
    return this.mergeSeed(file.entries);
  }

  async listPostable(): Promise<AllowlistEntry[]> {
    return (await this.load()).filter(
      (e) => e.status === "postable" && e.rulesOk
    );
  }

  /**
   * Names Reddit search should skip: postable, rejected, and proposed
   * still within the re-queue TTL. Stale proposed can reappear.
   */
  async listDiscoverExclude(requeueDays: number): Promise<string[]> {
    const entries = await this.load();
    return discoverExcludeNames(entries, { requeueDays });
  }

  async get(name: string): Promise<AllowlistEntry | undefined> {
    const n = normalizeSub(name).toLowerCase();
    return (await this.load()).find((e) => e.name.toLowerCase() === n);
  }

  async upsertProposed(candidate: {
    name: string;
    rulesOk: boolean;
    note: string;
    evidence?: string;
  }): Promise<AllowlistEntry> {
    const entries = await this.load();
    const n = normalizeSub(candidate.name);
    const idx = entries.findIndex(
      (e) => e.name.toLowerCase() === n.toLowerCase()
    );
    const now = new Date().toISOString();
    if (idx >= 0) {
      const prev = entries[idx]!;
      if (prev.status === "postable") return prev;
      const next: AllowlistEntry = {
        ...prev,
        rulesOk: candidate.rulesOk,
        note: candidate.note || prev.note,
        evidence: candidate.evidence ?? prev.evidence,
        status: "proposed",
        source: prev.source === "seed" ? "seed" : "discovered",
        updatedAt: now,
      };
      entries[idx] = next;
      await this.writeFile(entries);
      return next;
    }
    const created: AllowlistEntry = {
      name: n,
      rulesOk: candidate.rulesOk,
      note: candidate.note,
      evidence: candidate.evidence,
      source: "discovered",
      status: "proposed",
      score: 1,
      approvedCount: 0,
      abortedCount: 0,
      updatedAt: now,
    };
    entries.push(created);
    await this.writeFile(entries);
    return created;
  }

  /** Human gate: only this promotes a sub to postable for scout/execute. */
  async promote(name: string, note?: string): Promise<AllowlistEntry | null> {
    const entries = await this.load();
    const n = normalizeSub(name).toLowerCase();
    const idx = entries.findIndex((e) => e.name.toLowerCase() === n);
    const now = new Date().toISOString();
    // Fresh promotions outrank static seeds (score 10) so the next scout picks them.
    const freshScore = 12;
    if (idx < 0) {
      const created: AllowlistEntry = {
        name: normalizeSub(name),
        rulesOk: true,
        note: note ?? "Human-promoted discovery candidate",
        source: "discovered",
        status: "postable",
        score: freshScore,
        approvedCount: 0,
        abortedCount: 0,
        updatedAt: now,
      };
      entries.push(created);
      await this.writeFile(entries);
      return created;
    }
    const prev = entries[idx]!;
    const next: AllowlistEntry = {
      ...prev,
      status: "postable",
      rulesOk: true,
      note: note ?? prev.note,
      source: prev.source === "seed" ? "seed" : "discovered",
      score: Math.max(prev.score, freshScore),
      updatedAt: now,
    };
    entries[idx] = next;
    await this.writeFile(entries);
    return next;
  }

  async reject(name: string): Promise<void> {
    const entries = await this.load();
    const n = normalizeSub(name).toLowerCase();
    const idx = entries.findIndex((e) => e.name.toLowerCase() === n);
    if (idx < 0) return;
    entries[idx] = {
      ...entries[idx]!,
      status: "rejected",
      updatedAt: new Date().toISOString(),
    };
    await this.writeFile(entries);
  }

  /** Admin / tooling: shallow field update (persists merged list including seeds). */
  async patch(
    name: string,
    patch: Partial<
      Pick<AllowlistEntry, "note" | "score" | "rulesOk" | "status" | "evidence">
    >
  ): Promise<AllowlistEntry | null> {
    const entries = await this.load();
    const n = normalizeSub(name).toLowerCase();
    const idx = entries.findIndex((e) => e.name.toLowerCase() === n);
    if (idx < 0) return null;
    const prev = entries[idx]!;
    const next: AllowlistEntry = {
      ...prev,
      updatedAt: new Date().toISOString(),
    };
    if (patch.note !== undefined) next.note = patch.note;
    if (patch.evidence !== undefined) next.evidence = patch.evidence;
    if (patch.score !== undefined) {
      if (!Number.isFinite(patch.score)) {
        throw new Error("score must be a number");
      }
      next.score = patch.score;
    }
    if (patch.rulesOk !== undefined) next.rulesOk = patch.rulesOk;
    if (patch.status !== undefined) {
      next.status = patch.status;
      if (patch.status === "postable") {
        next.rulesOk = true;
        next.score = Math.max(next.score, 12);
      }
    }
    entries[idx] = next;
    await this.writeFile(entries);
    return next;
  }

  async recordOutcome(
    name: string,
    outcome: "approved" | "aborted" | "edited"
  ): Promise<void> {
    const entries = await this.load();
    const n = normalizeSub(name).toLowerCase();
    const idx = entries.findIndex((e) => e.name.toLowerCase() === n);
    if (idx < 0) return;
    const prev = entries[idx]!;
    const approved =
      outcome === "approved" || outcome === "edited"
        ? prev.approvedCount + 1
        : prev.approvedCount;
    const aborted =
      outcome === "aborted" ? prev.abortedCount + 1 : prev.abortedCount;
    const delta = outcome === "aborted" ? -1 : 1;
    entries[idx] = {
      ...prev,
      approvedCount: approved,
      abortedCount: aborted,
      score: Math.max(0, prev.score + delta),
      updatedAt: new Date().toISOString(),
    };
    await this.writeFile(entries);
  }

  /**
   * Ranked postable names for scout (least-recently scouted first).
   * When explore=true, reserve one slot for the newest human-promoted
   * discovered sub (so a just-promoted candidate is scouted this run).
   */
  async pickScoutSubs(
    max: number,
    explore: boolean,
    opts?: { prefer?: string }
  ): Promise<string[]> {
    const postable = (await this.listPostable()).sort(compareScoutPriority);
    if (postable.length === 0) {
      return ALLOWLISTED_SUBREDDITS.filter((s) => s.rulesOk).map((s) => s.name);
    }
    const limit = max > 0 ? max : postable.length;
    let picked = postable.slice(0, limit);

    const preferName = opts?.prefer?.replace(/^r\//i, "").trim().toLowerCase();
    const preferEntry = preferName
      ? postable.find((e) => e.name.toLowerCase() === preferName)
      : undefined;

    // Newest discovered promotion wins the explore slot (not an older one).
    const newestDiscovered = postable
      .filter((e) => e.source === "discovered")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

    const exploreEntry = preferEntry ?? (explore ? newestDiscovered : undefined);
    if (exploreEntry) {
      const already = picked.some(
        (p) => p.name.toLowerCase() === exploreEntry.name.toLowerCase()
      );
      if (!already) {
        if (picked.length >= limit && limit > 0) {
          picked = [...picked.slice(0, limit - 1), exploreEntry];
        } else {
          picked = [...picked, exploreEntry];
        }
        console.log(
          `[allowlist] explore/prefer slot → r/${exploreEntry.name}` +
            (preferEntry ? " (just promoted)" : " (newest discovered)")
        );
      }
    }
    return picked.map((e) => e.name);
  }

  /** Mark subs as scouted this run (rotation; does not change score). */
  async recordScouted(names: string[]): Promise<void> {
    if (names.length === 0) return;
    const entries = await this.load();
    const now = new Date().toISOString();
    const want = new Set(
      names.map((n) => normalizeSub(n).toLowerCase()).filter(Boolean)
    );
    let changed = false;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!;
      if (!want.has(e.name.toLowerCase())) continue;
      entries[i] = { ...e, lastScoutedAt: now };
      changed = true;
    }
    if (changed) await this.writeFile(entries);
  }

  private mergeSeed(existing: AllowlistEntry[]): AllowlistEntry[] {
    const byName = new Map(
      existing.map((e) => [e.name.toLowerCase(), e] as const)
    );
    for (const policy of ALLOWLISTED_SUBREDDITS) {
      const key = policy.name.toLowerCase();
      if (!byName.has(key)) {
        byName.set(key, seedEntry(policy));
      }
    }
    return [...byName.values()];
  }

  private async readFile(): Promise<AllowlistFile> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as AllowlistFile;
      if (!parsed || !Array.isArray(parsed.entries)) {
        return { version: 1, entries: [] };
      }
      return { version: 1, entries: parsed.entries };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return { version: 1, entries: [] };
      console.warn("[allowlist] read failed; using seed only:", err);
      return { version: 1, entries: [] };
    }
  }

  private async writeFile(entries: AllowlistEntry[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const payload: AllowlistFile = { version: 1, entries };
    await fs.writeFile(
      this.filePath,
      `${JSON.stringify(payload, null, 2)}\n`,
      "utf8"
    );
  }
}

let defaultStore: AllowlistStore | undefined;

export function getAllowlistStore(): AllowlistStore {
  if (!defaultStore) defaultStore = new AllowlistStore();
  return defaultStore;
}
