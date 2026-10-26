/**
 * Persist last soft-parked seat so Watch can reopen without a lease.
 */

export interface LastParkTarget {
  sessionId: string;
  vncUrl: string;
  parkedAt: string;
}

const KEY = "relay-desk.last-park.v1";

export function loadLastPark(): LastParkTarget | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastParkTarget>;
    const sessionId = String(parsed.sessionId ?? "").trim();
    const vncUrl = String(parsed.vncUrl ?? "").trim();
    if (!sessionId || !vncUrl) return null;
    return {
      sessionId,
      vncUrl,
      parkedAt: String(parsed.parkedAt ?? new Date().toISOString()),
    };
  } catch {
    return null;
  }
}

export function saveLastPark(target: LastParkTarget): void {
  localStorage.setItem(KEY, JSON.stringify(target));
}

export function clearLastPark(): void {
  localStorage.removeItem(KEY);
}
