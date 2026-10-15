import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { emptyScoutFallbackUtcDayKey } from "./empty-scout-fallback.js";

type LedgerFile = Record<string, number>;

function ledgerPath(dataDir: string): string {
  return path.join(dataDir, "discover", "empty-scout-fallback.json");
}

async function readLedger(dataDir: string): Promise<LedgerFile> {
  try {
    const raw = await readFile(ledgerPath(dataDir), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: LedgerFile = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n) && n >= 0) out[k] = Math.floor(n);
    }
    return out;
  } catch {
    return {};
  }
}

async function writeLedger(dataDir: string, data: LedgerFile): Promise<void> {
  const file = ledgerPath(dataDir);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

/** Current UTC-day count of empty-scout fallbacks started. */
export async function readEmptyScoutFallbackDailyCount(
  dataDir: string,
  now: Date = new Date()
): Promise<number> {
  const day = emptyScoutFallbackUtcDayKey(now);
  const data = await readLedger(dataDir);
  return data[day] ?? 0;
}

/**
 * Increment today's fallback start count. Returns the new count.
 * Call when a fallback **starts** (before discover runs).
 */
export async function incrementEmptyScoutFallbackDailyCount(
  dataDir: string,
  now: Date = new Date()
): Promise<number> {
  const day = emptyScoutFallbackUtcDayKey(now);
  const data = await readLedger(dataDir);
  const next = (data[day] ?? 0) + 1;
  data[day] = next;
  await writeLedger(dataDir, data);
  return next;
}
