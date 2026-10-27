import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  acquireSession,
  heartbeatSession,
  leaseSession,
  listGatewaySeats,
  probeGateway,
  recycleSession,
  softReleaseSession,
} from "./gateway/client.ts";
import {
  clearLastPark,
  loadLastPark,
  saveLastPark,
  type LastParkTarget,
} from "./gateway/last-park.ts";
import { loadSettings, saveSettings } from "./gateway/settings.ts";
import type {
  DeskSettings,
  GatewaySeat,
  GatewaySeatsResponse,
  SeatState,
} from "./gateway/types.ts";
import { withVncViewerParams } from "./gateway/vnc-url.ts";
import {
  fetchPending,
  probeHitl,
  respondHitl,
} from "./hitl/client.ts";
import {
  sessionIdFromPending,
  vncUrlFromPending,
  type PendingFeedback,
} from "./hitl/types.ts";
import {
  closeSeatWindow,
  openSeatInBrowser,
  openSeatWindow,
} from "./seat/open-seat.ts";

const HEARTBEAT_MS = 45_000;
const HITL_POLL_MS = 2_000;

/**
 * Relay Desk — operator console (DESIGN.md Phase 5).
 * Gateway / Watch / Seat / HITL tiles; Settings in header drawer.
 * Stream stays in a separate WebView.
 */
export function App() {
  const [settings, setSettings] = useState<DeskSettings>(() => loadSettings());
  const [probe, setProbe] = useState<string>("not checked");
  const [busy, setBusy] = useState(false);
  const [seat, setSeat] = useState<SeatState>({ phase: "idle" });
  const [watchUrlDraft, setWatchUrlDraft] = useState("");
  const [lastPark, setLastPark] = useState<LastParkTarget | null>(() =>
    loadLastPark()
  );
  const [hitlProbe, setHitlProbe] = useState("not checked");
  const [hitlPending, setHitlPending] = useState<PendingFeedback[]>([]);
  const [hitlError, setHitlError] = useState<string | undefined>();
  const [hitlBusy, setHitlBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pool, setPool] = useState<GatewaySeatsResponse | null>(null);
  const [poolError, setPoolError] = useState<string | undefined>();
  const openedHitlWatch = useRef<Set<string>>(new Set());
  const seatRef = useRef(seat);
  const settingsRef = useRef(settings);
  seatRef.current = seat;
  settingsRef.current = settings;

  const updateSettings = useCallback((patch: Partial<DeskSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const rememberPark = (sessionId: string, vncUrl: string) => {
    const target: LastParkTarget = {
      sessionId,
      vncUrl,
      parkedAt: new Date().toISOString(),
    };
    saveLastPark(target);
    setLastPark(target);
  };

  const refreshPool = useCallback(async () => {
    try {
      const next = await listGatewaySeats(settingsRef.current);
      setPool(next);
      setPoolError(undefined);
      return next;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPoolError(msg);
      return null;
    }
  }, []);

  const onProbe = async () => {
    setBusy(true);
    setProbe("checking…");
    try {
      setProbe(await probeGateway(settings));
      await refreshPool();
    } catch (err) {
      setProbe(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onProbeHitl = async () => {
    setBusy(true);
    setHitlProbe("checking…");
    try {
      setHitlProbe(await probeHitl(settings));
    } catch (err) {
      setHitlProbe(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onHitlRespond = async (
    req: PendingFeedback,
    action: "proceed" | "abort"
  ) => {
    setHitlBusy(true);
    setHitlError(undefined);
    try {
      await respondHitl(settings, req.id, action, action === "proceed");
      setHitlPending((prev) => prev.filter((p) => p.id !== req.id));
      openedHitlWatch.current.delete(req.id);
    } catch (err) {
      setHitlError(err instanceof Error ? err.message : String(err));
    } finally {
      setHitlBusy(false);
    }
  };

  const softParkFromSeatClose = async () => {
    const cur = seatRef.current;
    if (cur.phase !== "leased" || !cur.sessionId) return;
    try {
      await softReleaseSession(settingsRef.current, cur.sessionId);
      if (cur.vncUrl) rememberPark(cur.sessionId, cur.vncUrl);
      setSeat({
        phase: "parked",
        sessionId: cur.sessionId,
        vncUrl: cur.vncUrl,
        expiresAt: cur.expiresAt,
      });
    } catch (err) {
      setSeat({
        ...cur,
        phase: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const onWatchClose = () => {
    const cur = seatRef.current;
    if (cur.phase !== "watching") return;
    if (cur.sessionId && cur.vncUrl) {
      setSeat({
        phase: "parked",
        sessionId: cur.sessionId,
        vncUrl: cur.vncUrl,
        expiresAt: cur.expiresAt,
      });
      return;
    }
    setSeat({ phase: "idle", vncUrl: cur.vncUrl });
  };

  const startWatch = async (
    vncUrl: string,
    sessionId?: string,
    expiresAt?: string
  ) => {
    const url = withVncViewerParams(vncUrl.trim());
    if (!url) {
      setSeat({
        phase: "error",
        error: "Paste a worker vnc_url to Watch",
        sessionId: seat.sessionId,
        vncUrl: seat.vncUrl,
      });
      return;
    }
    setSeat({
      phase: "watching",
      sessionId,
      vncUrl: url,
      expiresAt,
      error: undefined,
    });
    setWatchUrlDraft(url);
    await openSeatWindow(url, {
      mode: "watch",
      onClosed: () => {
        onWatchClose();
      },
    });
  };

  const openWatchForHitl = async (req: PendingFeedback) => {
    const vnc = vncUrlFromPending(req);
    if (!vnc || openedHitlWatch.current.has(req.id)) return;
    openedHitlWatch.current.add(req.id);
    const sessionId = sessionIdFromPending(req);
    try {
      await startWatch(vnc, sessionId);
    } catch (err) {
      openedHitlWatch.current.delete(req.id);
      setHitlError(err instanceof Error ? err.message : String(err));
    }
  };

  const onLease = async () => {
    setBusy(true);
    try {
      const lease = await leaseSession(settings);
      setSeat({
        phase: "leased",
        sessionId: lease.session_id,
        vncUrl: lease.vnc_url,
        expiresAt: lease.expires_at,
        error: undefined,
      });
      await openSeatWindow(lease.vnc_url, {
        mode: "lease",
        onClosed: () => {
          void softParkFromSeatClose();
        },
      });
      await refreshPool();
    } catch (err) {
      setSeat({
        phase: "error",
        error: err instanceof Error ? err.message : String(err),
        sessionId: seat.sessionId,
        vncUrl: seat.vncUrl,
      });
      await refreshPool();
    } finally {
      setBusy(false);
    }
  };

  const onWatchPaste = async () => {
    if (seat.phase === "leased") return;
    setBusy(true);
    try {
      await startWatch(watchUrlDraft || seat.vncUrl || "");
    } catch (err) {
      setSeat({
        phase: "error",
        error: err instanceof Error ? err.message : String(err),
        sessionId: seat.sessionId,
        vncUrl: seat.vncUrl,
      });
    } finally {
      setBusy(false);
    }
  };

  const onWatchLastPark = async () => {
    if (seat.phase === "leased") return;
    const target =
      seat.phase === "parked" && seat.sessionId && seat.vncUrl
        ? { sessionId: seat.sessionId, vncUrl: seat.vncUrl, parkedAt: "" }
        : lastPark;
    if (!target) return;
    setBusy(true);
    try {
      await startWatch(target.vncUrl, target.sessionId);
    } catch (err) {
      setSeat({
        phase: "error",
        error: err instanceof Error ? err.message : String(err),
        sessionId: target.sessionId,
        vncUrl: target.vncUrl,
      });
    } finally {
      setBusy(false);
    }
  };

  const onPark = async () => {
    if (!seat.sessionId) return;
    setBusy(true);
    try {
      await softReleaseSession(settings, seat.sessionId);
      await closeSeatWindow();
      if (seat.vncUrl) rememberPark(seat.sessionId, seat.vncUrl);
      setSeat({
        phase: "parked",
        sessionId: seat.sessionId,
        vncUrl: seat.vncUrl,
        expiresAt: seat.expiresAt,
      });
    } catch (err) {
      setSeat({
        ...seat,
        phase: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  const onAcquire = async () => {
    const sessionId = seat.sessionId;
    if (!sessionId) return;
    setBusy(true);
    try {
      const lease = await acquireSession(settings, sessionId);
      setSeat({
        phase: "leased",
        sessionId: lease.session_id,
        vncUrl: lease.vnc_url,
        expiresAt: lease.expires_at,
        error: undefined,
      });
      await openSeatWindow(lease.vnc_url, {
        mode: "lease",
        onClosed: () => {
          void softParkFromSeatClose();
        },
      });
    } catch (err) {
      setSeat({
        ...seat,
        phase: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  const onRecycle = async () => {
    if (!seat.sessionId) return;
    setBusy(true);
    try {
      await recycleSession(settings, seat.sessionId);
      await closeSeatWindow();
      clearLastPark();
      setLastPark(null);
      setSeat({ phase: "idle" });
      await refreshPool();
    } catch (err) {
      setSeat({
        phase: "error",
        error: err instanceof Error ? err.message : String(err),
        sessionId: seat.sessionId,
        vncUrl: seat.vncUrl,
      });
    } finally {
      setBusy(false);
    }
  };

  /** Recycle a pool seat by session_id (from GET /v1/seats inventory). */
  const onRecyclePoolSeat = async (row: GatewaySeat) => {
    if (!row.session_id) return;
    setBusy(true);
    try {
      await recycleSession(settings, row.session_id);
      if (seat.sessionId === row.session_id) {
        await closeSeatWindow();
        clearLastPark();
        setLastPark(null);
        setSeat({ phase: "idle" });
      }
      await refreshPool();
    } catch (err) {
      setSeat({
        ...seat,
        phase: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      await refreshPool();
    } finally {
      setBusy(false);
    }
  };

  const onWatchPoolSeat = async (row: GatewaySeat) => {
    if (!row.vnc_url || seat.phase === "leased") return;
    setBusy(true);
    try {
      await startWatch(row.vnc_url, row.session_id ?? undefined);
    } catch (err) {
      setSeat({
        phase: "error",
        error: err instanceof Error ? err.message : String(err),
        sessionId: row.session_id ?? undefined,
        vncUrl: row.vnc_url,
      });
    } finally {
      setBusy(false);
    }
  };

  const onAcquirePoolSeat = async (row: GatewaySeat) => {
    if (!row.session_id || row.state !== "parked") return;
    setBusy(true);
    try {
      const lease = await acquireSession(settings, row.session_id);
      setSeat({
        phase: "leased",
        sessionId: lease.session_id,
        vncUrl: lease.vnc_url,
        expiresAt: lease.expires_at,
        error: undefined,
      });
      await openSeatWindow(lease.vnc_url, {
        mode: "lease",
        onClosed: () => {
          void softParkFromSeatClose();
        },
      });
      await refreshPool();
    } catch (err) {
      setSeat({
        phase: "error",
        error: err instanceof Error ? err.message : String(err),
        sessionId: row.session_id,
        vncUrl: row.vnc_url,
      });
      await refreshPool();
    } finally {
      setBusy(false);
    }
  };

  const onFocusStream = async () => {
    if (!seat.vncUrl) return;
    await openSeatWindow(seat.vncUrl, {
      mode: seat.phase === "watching" ? "watch" : "lease",
      onClosed:
        seat.phase === "leased"
          ? () => {
              void softParkFromSeatClose();
            }
          : seat.phase === "watching"
            ? () => {
                onWatchClose();
              }
            : undefined,
    });
  };

  const onCloseStream = async () => {
    if (seat.phase === "leased") {
      await onPark();
      return;
    }
    await closeSeatWindow();
    onWatchClose();
  };

  useEffect(() => {
    if (seat.phase !== "leased" || !seat.sessionId) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      if (document.visibilityState === "hidden") return;
      try {
        await heartbeatSession(settings, seat.sessionId!);
        if (!cancelled) {
          setSeat((s) => ({
            ...s,
            lastHeartbeatAt: new Date().toISOString(),
          }));
        }
      } catch (err) {
        if (!cancelled) {
          setSeat((s) => ({
            ...s,
            phase: "error",
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), HEARTBEAT_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [seat.phase, seat.sessionId, settings]);

  useEffect(() => {
    const onUnload = () => {
      const cur = seatRef.current;
      if (cur.phase === "leased" && cur.sessionId) {
        void softReleaseSession(settingsRef.current, cur.sessionId);
      }
    };
    window.addEventListener("pagehide", onUnload);
    return () => window.removeEventListener("pagehide", onUnload);
  }, []);

  useEffect(() => {
    if (!settings.hitlUrl.trim()) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const pending = await fetchPending(settingsRef.current);
        if (cancelled) return;
        setHitlPending(pending);
        setHitlError(undefined);
        const ids = new Set(pending.map((p) => p.id));
        for (const id of openedHitlWatch.current) {
          if (!ids.has(id)) openedHitlWatch.current.delete(id);
        }
        for (const req of pending) {
          if (vncUrlFromPending(req)) void openWatchForHitl(req);
        }
      } catch (err) {
        if (!cancelled) {
          setHitlPending([]);
          setHitlError(err instanceof Error ? err.message : String(err));
        }
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), HITL_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [settings.hitlUrl, settings.hitlToken]);

  const canAcquire =
    (seat.phase === "parked" || seat.phase === "watching") &&
    Boolean(seat.sessionId);
  const watchPasteReady = Boolean((watchUrlDraft || seat.vncUrl || "").trim());
  const hitl = hitlPending[0];
  const streamOpen = seat.phase === "leased" || seat.phase === "watching";

  const consoleTitle =
    hitl
      ? "HITL waiting"
      : seat.phase === "leased"
        ? "Leased"
        : seat.phase === "watching"
          ? "Watching"
          : seat.phase === "parked"
            ? "Parked"
            : "Idle console";

  const consoleSub =
    hitl
      ? `${hitl.type} · awaiting operator`
      : seat.phase === "leased"
        ? `claimed · ${seat.sessionId ?? "—"}`
        : seat.phase === "watching"
          ? seat.sessionId
            ? `${seat.sessionId} · observe only`
            : "observe only · no claim"
          : seat.phase === "parked"
            ? `session warm · ${seat.sessionId ?? "—"}`
            : "operator surface · no active lease";

  const statusLabel =
    hitl
      ? `HITL · ${hitl.type}`
      : seat.phase === "leased"
        ? `claimed · heartbeat`
        : seat.phase === "watching"
          ? "watching"
          : seat.phase === "parked"
            ? "parked · warm"
            : seat.phase === "error"
              ? "error"
              : "ready";

  const gatewayTitle =
    seat.phase === "leased"
      ? "Lease active"
      : seat.phase === "parked"
        ? "Parked · session warm"
        : probe.startsWith("reachable")
          ? "Probe · ready"
          : probe === "not checked"
            ? "Gateway"
            : "Probe";

  const poolSummary = pool
    ? `pool · free ${pool.free} · leased ${pool.leased} · parked ${pool.parked}`
    : null;
  const occupiedSeats = pool?.seats.filter((s) => s.state !== "free") ?? [];

  const statusDisplay =
    seat.phase === "idle" && !hitl
      ? probe.startsWith("reachable")
        ? "desk.hsv · ready"
        : statusLabel === "ready"
          ? "desk.hsv · ready"
          : statusLabel
      : statusLabel;

  return (
    <div class="desk">
      <header class="topbar">
        <div class="topbar-brand-wrap">
          <svg
            class="topbar-radio"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="2" />
            <path d="M4.93 4.93a10 10 0 0 0 0 14.14" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            <path d="M7.76 7.76a5.5 5.5 0 0 0 0 8.48" />
            <path d="M16.24 7.76a5.5 5.5 0 0 1 0 8.48" />
          </svg>
          <span class="topbar-brand">Relay Desk</span>
        </div>
        <div class="topbar-right">
          <button
            type="button"
            class="settings-btn"
            onClick={() => setSettingsOpen(true)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
              <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
              <path d="M19.4 13a7.7 7.7 0 0 0 .1-2l2-1.2-2-3.4-2.3.5a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.5 2.4a7.4 7.4 0 0 0-1.7 1L6.5 6.4l-2 3.4 2 1.2a7.7 7.7 0 0 0 0 2l-2 1.2 2 3.4 2.3-.5a7.4 7.4 0 0 0 1.7 1l.5 2.4h4l.5-2.4a7.4 7.4 0 0 0 1.7-1l2.3.5 2-3.4-2-1.2Z" />
            </svg>
            <span>Settings</span>
          </button>
          <p
            class="status-chip"
            data-phase={seat.phase}
            data-hitl={hitl ? "1" : "0"}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="m8.5 12.5 2.5 2.5 4.5-5" />
            </svg>
            <span>
              {statusDisplay}
              {seat.lastHeartbeatAt
                ? ` · hb ${new Date(seat.lastHeartbeatAt).toLocaleTimeString()}`
                : ""}
            </span>
          </p>
        </div>
      </header>

      <main class="desk-main">
        <div class="desk-body">
          <div class="console-head">
            <h1 class="console-title">{consoleTitle}</h1>
            <p class="console-sub">{consoleSub}</p>
          </div>

          <div class="bento">
          {/* HITL — col-span 7 */}
          <section class={`tile${hitl ? " hitl-active" : ""}`}>
            <div class="tile-stack">
              <p class="tile-label">HITL</p>
              {hitl ? (
                <div class="tile-copy">
                  <h2 class="tile-title">
                    {hitl.context?.title?.trim() || hitl.prompt.slice(0, 100)}
                  </h2>
                  <p class="tile-meta">
                    {hitl.context?.body?.slice(0, 160) || hitl.prompt}
                  </p>
                  {vncUrlFromPending(hitl) ? (
                    <p class="mono muted break">
                      stream · {vncUrlFromPending(hitl)}
                    </p>
                  ) : null}
                  {hitlError ? <p class="error">{hitlError}</p> : null}
                </div>
              ) : (
                <div class="tile-copy">
                  <h2 class="tile-title">No pending feedback</h2>
                  <p class="tile-meta">Runtime clear · waiting for a signal</p>
                  {hitlError ? <p class="error">{hitlError}</p> : null}
                </div>
              )}
            </div>
            {hitl ? (
              <div class="cta-row">
                <button
                  type="button"
                  class="cta"
                  disabled={hitlBusy}
                  onClick={() => void onHitlRespond(hitl, "proceed")}
                >
                  Approve
                </button>
                <button
                  type="button"
                  class="cta danger"
                  disabled={hitlBusy}
                  onClick={() => void onHitlRespond(hitl, "abort")}
                >
                  Abort
                </button>
                {vncUrlFromPending(hitl) ? (
                  <button
                    type="button"
                    class="cta ghost"
                    disabled={hitlBusy}
                    onClick={() => void openWatchForHitl(hitl)}
                  >
                    Focus Watch
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>

          {/* Seat — col-span 5 */}
          <section class="tile tile-narrow">
            <div class="tile-head">
              <p class="tile-label">Seat</p>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h10" />
              </svg>
            </div>
            {streamOpen && seat.vncUrl ? (
              <div class="tile-copy">
                <h2 class="tile-title">Active streams</h2>
                <div class="seat-rows">
                  <div class="seat-row">
                    <span>
                      <span
                        class="seat-row-mode"
                        data-mode={seat.phase === "leased" ? "Claimed" : "Watch"}
                      >
                        {seat.phase === "leased" ? "Claimed" : "Watch"}
                      </span>
                      {" · "}
                      {seat.sessionId?.slice(0, 12) || "stream"}
                    </span>
                    <div class="cta-row">
                      <button
                        type="button"
                        class="cta linkish"
                        disabled={busy}
                        onClick={() => void onFocusStream()}
                      >
                        Focus
                      </button>
                      <button
                        type="button"
                        class="cta linkish"
                        disabled={busy}
                        onClick={() => void onCloseStream()}
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </div>
                <p class="tile-meta">opens in a separate window</p>
              </div>
            ) : (
              <div class="tile-copy">
                <h2 class="tile-title">No active streams</h2>
                <p class="tile-meta">opens in new window</p>
              </div>
            )}
          </section>

          {/* Gateway — col-span 7 */}
          <section class="tile">
            <div class="tile-stack">
              <p class="tile-label">Gateway</p>
              <div class="tile-copy">
                <h2 class="tile-title">{gatewayTitle}</h2>
                <p class="tile-meta mono">
                  {seat.phase === "leased"
                    ? "heartbeat on · exclusive claim"
                    : seat.phase === "parked"
                      ? "Firefox warm · no claim"
                      : poolSummary
                        ? poolSummary
                        : probe === "not checked"
                          ? "desk.hsv · reachable"
                          : probe}
                </p>
                {seat.error ? <p class="error">{seat.error}</p> : null}
                {poolError ? (
                  <p class="error">
                    seats · {poolError} (redeploy gateway for GET /v1/seats)
                  </p>
                ) : null}
                {occupiedSeats.length > 0 ? (
                  <div class="pool-rows">
                    {occupiedSeats.map((row) => (
                      <div class="pool-row" key={row.id}>
                        <div class="pool-row-meta">
                          <span
                            class="pool-row-state"
                            data-state={row.state}
                          >
                            {row.id} · {row.state}
                          </span>
                          <span class="mono muted">
                            {row.session_id
                              ? row.session_id.slice(0, 8)
                              : "—"}
                            {row.job_id ? ` · ${row.job_id}` : ""}
                          </span>
                        </div>
                        <div class="cta-row pool-row-actions">
                          {row.vnc_url ? (
                            <button
                              type="button"
                              class="cta linkish"
                              disabled={busy || seat.phase === "leased"}
                              onClick={() => void onWatchPoolSeat(row)}
                            >
                              Watch
                            </button>
                          ) : null}
                          {row.state === "parked" && row.session_id ? (
                            <button
                              type="button"
                              class="cta linkish"
                              disabled={busy}
                              onClick={() => void onAcquirePoolSeat(row)}
                            >
                              Acquire
                            </button>
                          ) : null}
                          {row.session_id ? (
                            <button
                              type="button"
                              class="cta linkish"
                              disabled={busy}
                              onClick={() => void onRecyclePoolSeat(row)}
                            >
                              Recycle
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : pool ? (
                  <p class="tile-meta">all workers free</p>
                ) : null}
              </div>
            </div>
            <div class="cta-row">
              {seat.phase === "leased" ? (
                <>
                  <button
                    type="button"
                    class="cta ghost"
                    disabled={busy}
                    onClick={() => void onPark()}
                  >
                    Park
                  </button>
                  <button
                    type="button"
                    class="cta danger"
                    disabled={busy}
                    onClick={() => void onRecycle()}
                  >
                    Recycle
                  </button>
                  <button
                    type="button"
                    class="cta"
                    disabled={busy}
                    onClick={() => void onFocusStream()}
                  >
                    Focus stream
                  </button>
                </>
              ) : seat.phase === "parked" ? (
                <>
                  <button
                    type="button"
                    class="cta"
                    disabled={busy}
                    onClick={() => void onWatchLastPark()}
                  >
                    Watch
                  </button>
                  <button
                    type="button"
                    class="cta ghost"
                    disabled={busy || !canAcquire}
                    onClick={() => void onAcquire()}
                  >
                    Acquire
                  </button>
                  <button
                    type="button"
                    class="cta danger"
                    disabled={busy}
                    onClick={() => void onRecycle()}
                  >
                    Recycle
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    class="cta"
                    disabled={busy || seat.phase === "watching"}
                    onClick={() => void onLease()}
                  >
                    Open seat
                  </button>
                  {canAcquire ? (
                    <button
                      type="button"
                      class="cta ghost"
                      disabled={busy}
                      onClick={() => void onAcquire()}
                    >
                      Acquire
                    </button>
                  ) : null}
                  {seat.sessionId ? (
                    <button
                      type="button"
                      class="cta danger"
                      disabled={busy}
                      onClick={() => void onRecycle()}
                    >
                      Recycle
                    </button>
                  ) : null}
                </>
              )}
              <button
                type="button"
                class="cta linkish"
                disabled={busy}
                onClick={() => void refreshPool()}
              >
                Refresh seats
              </button>
            </div>
          </section>

          {/* Watch — col-span 5 */}
          <section class="tile tile-narrow">
            <div class="tile-stack">
              <p class="tile-label">Watch</p>
              <div class="tile-copy">
                <h2 class="tile-title">
                  {seat.phase === "watching" ? "Watch window open" : "Watch"}
                </h2>
                <p class="tile-meta">
                  {seat.phase === "watching"
                    ? "Eyes on Watch window · no claim"
                    : "observe without claim"}
                </p>
                <label class="field">
                  <span>vnc_url</span>
                  <input
                    value={watchUrlDraft}
                    placeholder="http://127.0.0.1:6080/vnc.html"
                    onInput={(e) =>
                      setWatchUrlDraft((e.target as HTMLInputElement).value)
                    }
                    spellcheck={false}
                  />
                </label>
              </div>
            </div>
            <div class="cta-row">
              <button
                type="button"
                class="cta"
                disabled={busy || seat.phase === "leased" || !watchPasteReady}
                onClick={() => void onWatchPaste()}
              >
                Watch
              </button>
              <button
                type="button"
                class="cta linkish"
                disabled={
                  busy ||
                  seat.phase === "leased" ||
                  !((seat.phase === "parked" && seat.vncUrl) || lastPark)
                }
                onClick={() => void onWatchLastPark()}
              >
                Watch last park
              </button>
              {seat.phase === "watching" ? (
                <>
                  <button
                    type="button"
                    class="cta ghost"
                    disabled={busy || !canAcquire}
                    onClick={() => void onAcquire()}
                  >
                    Acquire
                  </button>
                  <button
                    type="button"
                    class="cta ghost"
                    disabled={busy}
                    onClick={() => void onFocusStream()}
                  >
                    Focus
                  </button>
                </>
              ) : null}
              {seat.vncUrl ? (
                <button
                  type="button"
                  class="cta linkish"
                  disabled={busy}
                  onClick={() => void openSeatInBrowser(seat.vncUrl!)}
                >
                  Open in browser
                </button>
              ) : null}
            </div>
          </section>
          </div>
        </div>
      </main>

      {settingsOpen ? (
        <div
          class="drawer-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSettingsOpen(false);
          }}
        >
          <div class="drawer" role="dialog" aria-label="Settings">
            <h2>Settings</h2>
            <p class="tile-meta">Connection surfaces · stored locally</p>

            <div class="drawer-section">
              <h3>Gateway</h3>
              <label class="field">
                <span>COMPUTER_GATEWAY_URL</span>
                <input
                  value={settings.gatewayUrl}
                  onInput={(e) =>
                    updateSettings({
                      gatewayUrl: (e.target as HTMLInputElement).value,
                    })
                  }
                  spellcheck={false}
                />
              </label>
              <label class="field">
                <span>COMPUTER_API_TOKEN</span>
                <input
                  type="password"
                  value={settings.apiToken}
                  onInput={(e) =>
                    updateSettings({
                      apiToken: (e.target as HTMLInputElement).value,
                    })
                  }
                  spellcheck={false}
                />
              </label>
              <label class="field">
                <span>job_id</span>
                <input
                  value={settings.jobId}
                  onInput={(e) =>
                    updateSettings({
                      jobId: (e.target as HTMLInputElement).value,
                    })
                  }
                  spellcheck={false}
                />
              </label>
              <div class="cta-row">
                <button
                  type="button"
                  class="cta ghost"
                  disabled={busy}
                  onClick={() => void onProbe()}
                >
                  Probe
                </button>
                <span class="hint">{probe}</span>
              </div>
            </div>

            <div class="drawer-section">
              <h3>HITL bridge</h3>
              <label class="field">
                <span>DESK_HITL_URL</span>
                <input
                  value={settings.hitlUrl}
                  onInput={(e) =>
                    updateSettings({
                      hitlUrl: (e.target as HTMLInputElement).value,
                    })
                  }
                  spellcheck={false}
                />
              </label>
              <label class="field">
                <span>DESK_HITL_TOKEN</span>
                <input
                  type="password"
                  value={settings.hitlToken}
                  placeholder="optional"
                  onInput={(e) =>
                    updateSettings({
                      hitlToken: (e.target as HTMLInputElement).value,
                    })
                  }
                  spellcheck={false}
                />
              </label>
              <div class="cta-row">
                <button
                  type="button"
                  class="cta ghost"
                  disabled={busy}
                  onClick={() => void onProbeHitl()}
                >
                  Probe HITL
                </button>
                <span class="hint">{hitlProbe}</span>
              </div>
            </div>

            <div class="cta-row">
              <button
                type="button"
                class="cta"
                onClick={() => setSettingsOpen(false)}
              >
                Done
              </button>
              <button
                type="button"
                class="cta linkish"
                onClick={() => setSettingsOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
