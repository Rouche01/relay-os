import fs from "node:fs/promises";
import path from "node:path";

export type ScheduleRunStatus =
  | "ok"
  | "error"
  | "skipped_lease"
  | "skipped_protect"
  | "skipped_missed";

export interface ScheduleEvidence {
  scheduleId: string;
  entrypoint: string;
  runs: number;
  lastStartedAt?: string;
  lastFinishedAt?: string;
  lastStatus?: ScheduleRunStatus;
  lastError?: string;
  /** ISO time of the next planned fire (from croner / host). */
  nextRunAt?: string;
  /**
   * True when the schedule was paused via ops (`SchedulerHost.pause`).
   * Cleared on resume. Survives process restarts in evidence files so admin
   * can show last known pause state.
   */
  paused?: boolean;
  updatedAt: string;
}

export function scheduleEvidencePath(
  dataDir: string,
  scheduleId: string
): string {
  return path.join(
    dataDir,
    "schedules",
    `${scheduleId.replace(/[^a-zA-Z0-9._-]+/g, "_")}.evidence.json`
  );
}

export async function readScheduleEvidence(
  dataDir: string,
  scheduleId: string
): Promise<ScheduleEvidence | null> {
  const file = scheduleEvidencePath(dataDir, scheduleId);
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as ScheduleEvidence;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeScheduleEvidence(
  dataDir: string,
  evidence: ScheduleEvidence
): Promise<string> {
  const file = scheduleEvidencePath(dataDir, evidence.scheduleId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const next: ScheduleEvidence = {
    ...evidence,
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return file;
}

export function emptyEvidence(
  scheduleId: string,
  entrypoint: string
): ScheduleEvidence {
  return {
    scheduleId,
    entrypoint,
    runs: 0,
    updatedAt: new Date().toISOString(),
  };
}
