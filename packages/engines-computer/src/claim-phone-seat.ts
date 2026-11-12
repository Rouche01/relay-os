import type { EngineResult } from "@relay/protocol";
import type { ComputerEngine } from "./computer-engine.js";
import type { GatewaySeat } from "./types.js";

export interface ClaimPhoneSeatOptions {
  jobId?: string;
  agentId?: string;
  ttlSec?: number;
  /**
   * Acquire this parked session directly (skip free lease).
   * Env/CLI: COMPUTER_SESSION_ID / --session-id.
   */
  sessionId?: string;
  /** When falling back to parked inventory, prefer this seat id. */
  seatId?: string;
}

function isPhoneSeat(seat: GatewaySeat): boolean {
  return seat.kind === "phone";
}

function pickParkedPhone(
  seats: GatewaySeat[],
  seatId?: string
): GatewaySeat | undefined {
  const parked = seats.filter(
    (s) =>
      isPhoneSeat(s) &&
      s.state === "parked" &&
      typeof s.session_id === "string" &&
      s.session_id.trim().length > 0
  );
  if (seatId) {
    const match = parked.find((s) => s.id === seatId);
    if (match) return match;
  }
  return parked[0];
}

/**
 * Claim a phone seat for dogfood / agents:
 * 1. Explicit `sessionId` → acquire
 * 2. Else lease `{ kind: "phone" }` (free seat)
 * 3. Else acquire a parked phone from GET /v1/seats
 *
 * Does not steal actively leased seats.
 */
export async function claimPhoneSeat(
  engine: ComputerEngine,
  opts: ClaimPhoneSeatOptions = {}
): Promise<EngineResult> {
  const common = {
    ...(opts.jobId ? { job_id: opts.jobId } : {}),
    ...(opts.agentId ? { agent_id: opts.agentId } : {}),
    ...(opts.ttlSec != null ? { ttl_sec: opts.ttlSec } : {}),
  };

  const explicit = opts.sessionId?.trim();
  if (explicit) {
    const acquired = await engine.execute({
      type: "acquire",
      params: { ...common, session_id: explicit },
    });
    if (!acquired.success) return acquired;
    return {
      ...acquired,
      data: { ...(acquired.data ?? {}), via: "acquire", session_id: explicit },
    };
  }

  const leased = await engine.execute({
    type: "lease",
    params: { ...common, kind: "phone" },
  });
  if (leased.success) {
    return {
      ...leased,
      data: { ...(leased.data ?? {}), via: "lease" },
    };
  }

  const inventory = await engine.listSeats();
  if (!inventory.success) {
    return {
      success: false,
      error: `phone lease failed (${leased.error ?? "unknown"}); also could not list seats: ${inventory.error ?? "unknown"}`,
    };
  }

  const seats = (inventory.data?.seats as GatewaySeat[] | undefined) ?? [];
  const parked = pickParkedPhone(seats, opts.seatId?.trim());
  if (!parked?.session_id) {
    const phoneStates = seats
      .filter(isPhoneSeat)
      .map((s) => `${s.id}:${s.state ?? "?"}`)
      .join(", ");
    return {
      success: false,
      error: `no free phone seat (${leased.error ?? "lease failed"}) and no parked phone session to acquire${
        phoneStates ? ` [phones: ${phoneStates}]` : ""
      }`,
    };
  }

  const acquired = await engine.execute({
    type: "acquire",
    params: { ...common, session_id: parked.session_id },
  });
  if (!acquired.success) return acquired;
  return {
    ...acquired,
    data: {
      ...(acquired.data ?? {}),
      via: "acquire",
      seat_id: parked.id,
      session_id: parked.session_id,
      resumed_parked: true,
    },
  };
}
