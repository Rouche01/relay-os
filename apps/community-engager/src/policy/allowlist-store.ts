import fs from "node:fs/promises";
import path from "node:path";
import {
  normalizePlaybook,
  seedPlaybookFor,
  type SubredditPlaybook,
} from "./playbook.js";
import {
  ALLOWLISTED_SUBREDDITS,
  getCommunityConfig,
  getSubredditPolicy,
  type SubredditPolicy,
} from "../reddit/config.js";

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
  /** Operational playbook (rules, plug style, megathreads, plugs/week). */
  playbook: SubredditPlaybook;
}

interface AllowlistFile {
  version: 1;
  entries: AllowlistEntry[];
  /**
   * Subs removed via admin delete. Seeds in this list are not re-merged
   * as postable; discover also skips them until promote clears the name.
   */
  suppressed?: string[];
}

function normalizeSub(name: string): string {
  return name.replace(/^r\//i, "").trim();
}

function normalizeSuppressed(names: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = normalizeSub(raw);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
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
    playbook: seedPlaybookFor(policy.name, policy),
  };
}

/** Resolve playbook for a sub (allowlist entry → seed → default). */
export function resolvePlaybook(
  entryOrName: AllowlistEntry | string | undefined
): SubredditPlaybook {
  if (typeof entryOrName === "string" || entryOrName === undefined) {
    const policy = entryOrName ? getSubredditPolicy(entryOrName) : undefined;
    return seedPlaybookFor(entryOrName ?? "", policy);
  }
  return normalizePlaybook(entryOrName.playbook, entryOrName.note);
}

function ensurePlaybook(entry: AllowlistEntry): AllowlistEntry {
  if (entry.playbook && typeof entry.playbook === "object") {
    return {
      ...entry,
      playbook: normalizePlaybook(entry.playbook, entry.note),
    };
  }
  const policy = getSubredditPolicy(entry.name);
  return {
    ...entry,
    playbook: seedPlaybookFor(entry.name, policy ?? { note: entry.note }),
  };
}

/**
 * Durable postable-sub allowlist (write gate).
 * VoltMem gets mirrored facts; this file is what scout reads.
 */
export class AllowlistStore {
  private readonly filePath: string;

  constructor(filePath?: string) {
    const cfg = getCommunityConfig();
    this.filePath =
      filePath ?? path.join(cfg.reddit.dataDir, "allowlist", "subreddits.json");
  }

  async load(): Promise<AllowlistEntry[]> {
    const file = await this.readFile();
    return this.mergeSeed(file.entries, file.suppressed).map(ensurePlaybook);
  }

  /** Admin-removed sub names (durable; blocks seed revive + discover). */
  async listSuppressed(): Promise<string[]> {
    const file = await this.readFile();
    return normalizeSuppressed(file.suppressed ?? []);
  }

  /** name → playbook for scout/draft (postable + seed defaults). */
  async playbookMap(): Promise<Map<string, SubredditPlaybook>> {
    const map = new Map<string, SubredditPlaybook>();
    const suppressed = new Set(
      (await this.listSuppressed()).map((n) => n.toLowerCase())
    );
    for (const e of await this.load()) {
      map.set(e.name.toLowerCase(), resolvePlaybook(e));
    }
    for (const policy of ALLOWLISTED_SUBREDDITS) {
      const key = policy.name.toLowerCase();
      if (suppressed.has(key)) continue;
      if (!map.has(key)) map.set(key, seedPlaybookFor(policy.name, policy));
    }
    return map;
  }

  async listPostable(): Promise<AllowlistEntry[]> {
    return (await this.load()).filter(
      (e) => e.status === "postable" && e.rulesOk
    );
  }

  /**
   * Names Reddit search should skip: postable, rejected, and proposed
   * still within the re-queue TTL. Stale proposed can reappear.
   * Admin-suppressed names are always excluded.
   */
  async listDiscoverExclude(requeueDays: number): Promise<string[]> {
    const entries = await this.load();
    const fromEntries = discoverExcludeNames(entries, { requeueDays });
    const suppressed = await this.listSuppressed();
    return [...new Set([...fromEntries, ...suppressed])];
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
      playbook: normalizePlaybook(undefined, candidate.note),
    };
    entries.push(created);
    await this.writeFile(entries);
    return created;
  }

  /** Human gate: only this promotes a sub to postable for scout/execute. */
  async promote(name: string, note?: string): Promise<AllowlistEntry | null> {
    const file = await this.readFile();
    const entries = this.mergeSeed(file.entries, file.suppressed).map(
      ensurePlaybook
    );
    const n = normalizeSub(name).toLowerCase();
    const idx = entries.findIndex((e) => e.name.toLowerCase() === n);
    const now = new Date().toISOString();
    // Fresh promotions outrank static seeds (score 10) so the next scout picks them.
    const freshScore = 12;
    // Recovery after admin delete: clear suppression so the sub can return.
    const suppressed = normalizeSuppressed(file.suppressed ?? []).filter(
      (s) => s.toLowerCase() !== n
    );
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
        playbook: normalizePlaybook(undefined, note ?? "Human-promoted discovery candidate"),
      };
      entries.push(created);
      await this.writeFile(entries, { suppressed });
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
    await this.writeFile(entries, { suppressed });
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

  /**
   * Admin delete: drop the row and suppress the name so seed merge cannot
   * revive it. Returns true when the name was removed and/or newly suppressed.
   */
  async remove(name: string): Promise<boolean> {
    const file = await this.readFile();
    const n = normalizeSub(name);
    if (!n) return false;
    const key = n.toLowerCase();
    const entries = this.mergeSeed(file.entries, file.suppressed).map(
      ensurePlaybook
    );
    const nextEntries = entries.filter((e) => e.name.toLowerCase() !== key);
    const prevSuppressed = normalizeSuppressed(file.suppressed ?? []);
    const already = prevSuppressed.some((s) => s.toLowerCase() === key);
    const suppressed = already
      ? prevSuppressed
      : normalizeSuppressed([...prevSuppressed, n]);
    const changed = nextEntries.length !== entries.length || !already;
    if (!changed) return false;
    await this.writeFile(nextEntries, { suppressed });
    return true;
  }

  /** Admin / tooling: shallow field update (persists merged list including seeds). */
  async patch(
    name: string,
    patch: Partial<
      Pick<
        AllowlistEntry,
        "note" | "score" | "rulesOk" | "status" | "evidence" | "playbook"
      >
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
    if (patch.playbook !== undefined) {
      next.playbook = normalizePlaybook(patch.playbook, next.note);
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
      const suppressed = new Set(
        (await this.listSuppressed()).map((s) => s.toLowerCase())
      );
      return ALLOWLISTED_SUBREDDITS.filter(
        (s) => s.rulesOk && !suppressed.has(s.name.toLowerCase())
      ).map((s) => s.name);
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

  private mergeSeed(
    existing: AllowlistEntry[],
    suppressed?: readonly string[]
  ): AllowlistEntry[] {
    const blocked = new Set(
      normalizeSuppressed(suppressed ?? []).map((s) => s.toLowerCase())
    );
    const byName = new Map(
      existing
        .filter((e) => !blocked.has(e.name.toLowerCase()))
        .map((e) => [e.name.toLowerCase(), ensurePlaybook(e)] as const)
    );
    for (const policy of ALLOWLISTED_SUBREDDITS) {
      const key = policy.name.toLowerCase();
      if (blocked.has(key)) continue;
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
      return {
        version: 1,
        entries: parsed.entries,
        suppressed: normalizeSuppressed(parsed.suppressed ?? []),
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return { version: 1, entries: [] };
      console.warn("[allowlist] read failed; using seed only:", err);
      return { version: 1, entries: [] };
    }
  }

  private async writeFile(
    entries: AllowlistEntry[],
    opts?: { suppressed?: string[] }
  ): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const prev =
      opts?.suppressed !== undefined ? undefined : await this.readFile();
    const suppressed = normalizeSuppressed(
      opts?.suppressed ?? prev?.suppressed ?? []
    );
    const payload: AllowlistFile = {
      version: 1,
      entries,
      ...(suppressed.length ? { suppressed } : {}),
    };
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
