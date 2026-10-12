import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface LeasePayload {
  scheduleId: string;
  pid: number;
  hostname: string;
  acquiredAt: string;
}

export interface LeaseHandle {
  path: string;
  payload: LeasePayload;
  release(): Promise<void>;
}

/** Default: treat locks older than 2h as stale (crashed host). */
export const DEFAULT_STALE_MS = 2 * 60 * 60 * 1000;

export function scheduleLockPath(dataDir: string, scheduleId: string): string {
  return path.join(dataDir, "schedules", `${sanitizeId(scheduleId)}.lock`);
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readPayload(lockPath: string): Promise<LeasePayload | null> {
  try {
    const raw = await fs.readFile(lockPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<LeasePayload>;
    if (
      typeof parsed.scheduleId !== "string" ||
      typeof parsed.pid !== "number" ||
      typeof parsed.hostname !== "string" ||
      typeof parsed.acquiredAt !== "string"
    ) {
      return null;
    }
    return parsed as LeasePayload;
  } catch {
    return null;
  }
}

function isStale(payload: LeasePayload, staleMs: number, now: number): boolean {
  if (!isPidAlive(payload.pid)) return true;
  const acquired = Date.parse(payload.acquiredAt);
  if (!Number.isFinite(acquired)) return true;
  return now - acquired > staleMs;
}

/**
 * Exclusive file lease under `{dataDir}/schedules/{id}.lock`.
 * Returns null if another live host holds the lock.
 */
export async function tryAcquireLease(
  dataDir: string,
  scheduleId: string,
  opts?: { staleMs?: number; now?: number }
): Promise<LeaseHandle | null> {
  const staleMs = opts?.staleMs ?? DEFAULT_STALE_MS;
  const now = opts?.now ?? Date.now();
  const lockPath = scheduleLockPath(dataDir, scheduleId);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  const payload: LeasePayload = {
    scheduleId,
    pid: process.pid,
    hostname: os.hostname(),
    acquiredAt: new Date(now).toISOString(),
  };
  const body = `${JSON.stringify(payload, null, 2)}\n`;

  try {
    await fs.writeFile(lockPath, body, { flag: "wx" });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw err;

    const existing = await readPayload(lockPath);
    if (existing && !isStale(existing, staleMs, now)) {
      return null;
    }
    // Stale or corrupt — replace atomically via temp + rename when possible.
    const tmp = `${lockPath}.${process.pid}.tmp`;
    await fs.writeFile(tmp, body, "utf8");
    await fs.rename(tmp, lockPath);
  }

  return {
    path: lockPath,
    payload,
    async release() {
      try {
        const current = await readPayload(lockPath);
        if (current?.pid === process.pid && current.scheduleId === scheduleId) {
          await fs.unlink(lockPath);
        }
      } catch {
        // best-effort
      }
    },
  };
}
