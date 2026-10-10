import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { allowlistPath, jobsDir, runsDir } from "./data-dir.js";

export type AllowlistStatus = "postable" | "proposed" | "rejected";

export interface AllowlistEntry {
  name: string;
  rulesOk: boolean;
  note: string;
  source: "seed" | "discovered";
  status: AllowlistStatus;
  score: number;
  approvedCount: number;
  abortedCount: number;
  evidence?: string;
  updatedAt: string;
  lastScoutedAt?: string;
}

type AllowlistFile = { version: 1; entries: AllowlistEntry[] };

export const ALLOWLIST_STATUSES: AllowlistStatus[] = [
  "postable",
  "proposed",
  "rejected",
];

export function isAllowlistStatus(v: string): v is AllowlistStatus {
  return (ALLOWLIST_STATUSES as string[]).includes(v);
}

async function readAllowlistFile(filePath: string): Promise<AllowlistFile> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as AllowlistFile;
    if (!parsed || !Array.isArray(parsed.entries)) {
      return { version: 1, entries: [] };
    }
    return { version: 1, entries: parsed.entries };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { version: 1, entries: [] };
    }
    throw err;
  }
}

async function writeAllowlistFile(
  filePath: string,
  entries: AllowlistEntry[]
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const body = JSON.stringify({ version: 1, entries }, null, 2);
  await writeFile(tmp, body, "utf8");
  await rename(tmp, filePath);
}

function normalizeSub(name: string): string {
  return name.replace(/^r\//i, "").trim();
}

export async function listAllowlist(
  dataDir: string,
  filter: { status?: AllowlistStatus; limit?: number } = {}
): Promise<AllowlistEntry[]> {
  const { entries } = await readAllowlistFile(allowlistPath(dataDir));
  let result = [...entries].sort((a, b) =>
    a.updatedAt < b.updatedAt ? 1 : -1
  );
  if (filter.status) {
    result = result.filter((e) => e.status === filter.status);
  }
  if (filter.limit !== undefined && filter.limit >= 0) {
    result = result.slice(0, filter.limit);
  }
  return result;
}

export async function getAllowlistEntry(
  dataDir: string,
  name: string
): Promise<AllowlistEntry | null> {
  const n = normalizeSub(name).toLowerCase();
  const { entries } = await readAllowlistFile(allowlistPath(dataDir));
  return entries.find((e) => e.name.toLowerCase() === n) ?? null;
}

export async function patchAllowlistEntry(
  dataDir: string,
  name: string,
  patch: Partial<
    Pick<AllowlistEntry, "note" | "score" | "rulesOk" | "status" | "evidence">
  >
): Promise<AllowlistEntry> {
  const filePath = allowlistPath(dataDir);
  const file = await readAllowlistFile(filePath);
  const n = normalizeSub(name).toLowerCase();
  const idx = file.entries.findIndex((e) => e.name.toLowerCase() === n);
  if (idx < 0) throw new Error(`Allowlist entry not found: ${name}`);

  const prev = file.entries[idx]!;
  const next: AllowlistEntry = {
    ...prev,
    updatedAt: new Date().toISOString(),
  };

  if (patch.note !== undefined) next.note = String(patch.note);
  if (patch.evidence !== undefined) next.evidence = String(patch.evidence);
  if (patch.score !== undefined) {
    const score = Number(patch.score);
    if (!Number.isFinite(score)) throw new Error("score must be a number");
    next.score = score;
  }
  if (patch.rulesOk !== undefined) next.rulesOk = Boolean(patch.rulesOk);

  if (patch.status !== undefined) {
    if (!isAllowlistStatus(patch.status)) {
      throw new Error(`Invalid allowlist status: ${patch.status}`);
    }
    next.status = patch.status;
    if (patch.status === "postable") {
      next.rulesOk = true;
      next.score = Math.max(next.score, 12);
    }
  }

  file.entries[idx] = next;
  await writeAllowlistFile(filePath, file.entries);
  return next;
}

export async function promoteAllowlistEntry(
  dataDir: string,
  name: string,
  note?: string
): Promise<AllowlistEntry> {
  const existing = await getAllowlistEntry(dataDir, name);
  if (existing) {
    return patchAllowlistEntry(dataDir, name, {
      status: "postable",
      rulesOk: true,
      ...(note !== undefined ? { note } : {}),
    });
  }
  const filePath = allowlistPath(dataDir);
  const file = await readAllowlistFile(filePath);
  const created: AllowlistEntry = {
    name: normalizeSub(name),
    rulesOk: true,
    note: note ?? "Human-promoted via admin",
    source: "discovered",
    status: "postable",
    score: 12,
    approvedCount: 0,
    abortedCount: 0,
    updatedAt: new Date().toISOString(),
  };
  file.entries.push(created);
  await writeAllowlistFile(filePath, file.entries);
  return created;
}

export async function rejectAllowlistEntry(
  dataDir: string,
  name: string
): Promise<AllowlistEntry> {
  return patchAllowlistEntry(dataDir, name, { status: "rejected" });
}

export interface JobSummary {
  id: string;
  file: string;
  ok?: boolean;
  dryRun?: boolean;
  jobId?: string;
  transport?: string;
  error?: string;
  mtimeMs: number;
  preview: string;
}

async function listJsonDir(
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

function jobPreview(data: Record<string, unknown>): string {
  const log = typeof data.log === "string" ? data.log : "";
  const err = typeof data.error === "string" ? data.error : "";
  const text = (err || log).replace(/\s+/g, " ").trim();
  return text.slice(0, 100) || "—";
}

export async function listJobs(
  dataDir: string,
  limit?: number
): Promise<JobSummary[]> {
  const dir = jobsDir(dataDir);
  const files = await listJsonDir(dir, limit);
  const out: JobSummary[] = [];
  for (const f of files) {
    try {
      const raw = await readFile(path.join(dir, f.name), "utf8");
      const data = JSON.parse(raw) as Record<string, unknown>;
      out.push({
        id: f.name.replace(/\.json$/, ""),
        file: f.name,
        ok: typeof data.ok === "boolean" ? data.ok : undefined,
        dryRun: typeof data.dryRun === "boolean" ? data.dryRun : undefined,
        jobId: typeof data.jobId === "string" ? data.jobId : undefined,
        transport:
          typeof data.transport === "string" ? data.transport : undefined,
        error: typeof data.error === "string" ? data.error : undefined,
        mtimeMs: f.mtimeMs,
        preview: jobPreview(data),
      });
    } catch {
      out.push({
        id: f.name.replace(/\.json$/, ""),
        file: f.name,
        mtimeMs: f.mtimeMs,
        preview: "(unreadable)",
      });
    }
  }
  return out;
}

export async function getJob(
  dataDir: string,
  id: string
): Promise<{ file: string; record: unknown } | null> {
  const dir = jobsDir(dataDir);
  const file = id.endsWith(".json") ? id : `${id}.json`;
  const safe = path.basename(file);
  try {
    const raw = await readFile(path.join(dir, safe), "utf8");
    return { file: safe, record: JSON.parse(raw) as unknown };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw err;
  }
}

export async function deleteJob(dataDir: string, id: string): Promise<boolean> {
  const dir = jobsDir(dataDir);
  const file = id.endsWith(".json") ? id : `${id}.json`;
  const safe = path.basename(file);
  try {
    await unlink(path.join(dir, safe));
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return false;
    throw err;
  }
}

export interface RunSummaryRow {
  id: string;
  file: string;
  runId?: string;
  endedAt?: string;
  runState?: string;
  scouted?: number;
  jobs?: number;
  mtimeMs: number;
  preview: string;
}

export async function listRuns(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
  limit?: number
): Promise<RunSummaryRow[]> {
  const dir = runsDir(env, dataDir);
  const files = await listJsonDir(dir, limit);
  const out: RunSummaryRow[] = [];
  for (const f of files) {
    try {
      const raw = await readFile(path.join(dir, f.name), "utf8");
      const data = JSON.parse(raw) as {
        runId?: string;
        endedAt?: string;
        summary?: { runState?: string; scouted?: number; jobs?: unknown[] };
      };
      const jobs = Array.isArray(data.summary?.jobs)
        ? data.summary.jobs.length
        : undefined;
      out.push({
        id: f.name.replace(/\.json$/, ""),
        file: f.name,
        runId: data.runId,
        endedAt: data.endedAt,
        runState: data.summary?.runState,
        scouted: data.summary?.scouted,
        jobs,
        mtimeMs: f.mtimeMs,
        preview: [
          data.summary?.runState,
          data.summary?.scouted != null ? `scouted=${data.summary.scouted}` : null,
          jobs != null ? `jobs=${jobs}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "—",
      });
    } catch {
      out.push({
        id: f.name.replace(/\.json$/, ""),
        file: f.name,
        mtimeMs: f.mtimeMs,
        preview: "(unreadable)",
      });
    }
  }
  return out;
}

export async function getRun(
  dataDir: string,
  id: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ file: string; record: unknown } | null> {
  const dir = runsDir(env, dataDir);
  const file = id.endsWith(".json") ? id : `${id}.json`;
  const safe = path.basename(file);
  try {
    const raw = await readFile(path.join(dir, safe), "utf8");
    return { file: safe, record: JSON.parse(raw) as unknown };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw err;
  }
}

export async function deleteRun(
  dataDir: string,
  id: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  const dir = runsDir(env, dataDir);
  const file = id.endsWith(".json") ? id : `${id}.json`;
  const safe = path.basename(file);
  try {
    await unlink(path.join(dir, safe));
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return false;
    throw err;
  }
}
