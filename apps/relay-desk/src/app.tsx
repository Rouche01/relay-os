import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  acquireSession,
  heartbeatSession,
  leaseSession,
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
import type { DeskSettings, SeatState } from "./gateway/types.ts";
import { withVncViewerParams } from "./gateway/vnc-url.ts";
import {
  closeSeatWindow,
  openSeatInBrowser,
  openSeatWindow,
} from "./seat/open-seat.ts";

const HEARTBEAT_MS = 45_000;

/**
 * Relay Desk — HITL operator shell.
 * Phase 1.5: Watch (stream only) beside Open seat / Acquire (exclusive lease).
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

  const onProbe = async () => {
    setBusy(true);
    setProbe("checking…");
    try {
      const msg = await probeGateway(settings);
      setProbe(msg);
    } catch (err) {
      setProbe(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
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

  // Heartbeat while leased only — Watch never claims the seat.
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

  // Soft-park on main window unload while leased.
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

  const canAcquire =
    (seat.phase === "parked" || seat.phase === "watching") && Boolean(seat.sessionId);
  const watchPasteReady = Boolean((watchUrlDraft || seat.vncUrl || "").trim());

  const statusLabel =
    seat.phase === "leased"
      ? `leased · ${seat.sessionId}`
      : seat.phase === "watching"
        ? seat.sessionId
          ? `watching · ${seat.sessionId}`
          : "watching (no claim)"
        : seat.phase === "parked"
          ? `parked · ${seat.sessionId}`
          : seat.phase === "error"
            ? "error"
            : "idle";

  return (
    <div class="desk">
      <header class="brand">
        <div class="brand-block">
          <span class="brand-name">Relay Desk</span>
          <span class="brand-sub">Operator · HITL · computer seat</span>
        </div>
        <p class="status" data-phase={seat.phase}>
          {statusLabel}
          {seat.lastHeartbeatAt
            ? ` · hb ${new Date(seat.lastHeartbeatAt).toLocaleTimeString()}`
            : ""}
        </p>
      </header>

      <main class="stage">
        <section class="panel">
          <h2>Gateway</h2>
          <label class="field">
            <span>COMPUTER_GATEWAY_URL</span>
            <input
              value={settings.gatewayUrl}
              onInput={(e) =>
                updateSettings({ gatewayUrl: (e.target as HTMLInputElement).value })
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
                updateSettings({ apiToken: (e.target as HTMLInputElement).value })
              }
              spellcheck={false}
            />
          </label>
          <label class="field">
            <span>job_id</span>
            <input
              value={settings.jobId}
              onInput={(e) =>
                updateSettings({ jobId: (e.target as HTMLInputElement).value })
              }
              spellcheck={false}
            />
          </label>
          <div class="cta-row">
            <button type="button" class="cta ghost" disabled={busy} onClick={onProbe}>
              Probe
            </button>
            <span class="hint">{probe}</span>
          </div>

          <h2>Watch</h2>
          <p class="muted">
            Stream only — no lease, no heartbeat. Use Acquire when you need control.
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
          <div class="cta-row wrap">
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
              class="cta ghost"
              disabled={
                busy ||
                seat.phase === "leased" ||
                !(
                  (seat.phase === "parked" && seat.vncUrl) ||
                  lastPark
                )
              }
              onClick={() => void onWatchLastPark()}
            >
              Watch last park
            </button>
            <button
              type="button"
              class="cta ghost"
              disabled={busy || !canAcquire}
              onClick={() => void onAcquire()}
              title="Take exclusive lease on this session"
            >
              Acquire
            </button>
          </div>
          {lastPark ? (
            <p class="mono muted break">
              last park · {lastPark.sessionId}
            </p>
          ) : null}

          <h2>Seat</h2>
          <div class="cta-row wrap">
            <button
              type="button"
              class="cta"
              disabled={busy || seat.phase === "leased"}
              onClick={onLease}
            >
              Open seat
            </button>
            <button
              type="button"
              class="cta ghost"
              disabled={busy || seat.phase !== "leased"}
              onClick={onPark}
            >
              Park
            </button>
            <button
              type="button"
              class="cta danger"
              disabled={busy || !seat.sessionId}
              onClick={onRecycle}
            >
              Recycle
            </button>
          </div>
          {seat.vncUrl ? (
            <div class="cta-row">
              <button
                type="button"
                class="cta ghost"
                disabled={busy}
                onClick={() =>
                  void openSeatWindow(seat.vncUrl!, {
                    mode: seat.phase === "watching" ? "watch" : "lease",
                  })
                }
              >
                Focus stream
              </button>
              <button
                type="button"
                class="cta ghost"
                disabled={busy}
                onClick={() => void openSeatInBrowser(seat.vncUrl!)}
              >
                Open in browser
              </button>
            </div>
          ) : null}
          {seat.error ? <p class="error">{seat.error}</p> : null}
          {seat.vncUrl ? (
            <p class="mono muted break">{seat.vncUrl}</p>
          ) : (
            <p class="muted">
              Watch a known `vnc_url`, or Open seat to lease a free worker.
            </p>
          )}
        </section>

        <aside class="seat-placeholder" aria-label="Seat stream">
          {seat.phase === "leased" && seat.vncUrl ? (
            <>
              <p>Seat claimed</p>
              <p class="muted">Heartbeat on · soft-park if you close the stream.</p>
            </>
          ) : seat.phase === "watching" ? (
            <>
              <p>Watching (no claim)</p>
              <p class="muted">
                {seat.sessionId
                  ? "Acquire to take mouse/keyboard on this session."
                  : "Paste-only watch — no session to acquire."}
              </p>
            </>
          ) : seat.phase === "parked" ? (
            <>
              <p>Parked (Firefox warm)</p>
              <p class="muted">Watch to stream, or Acquire to reclaim control.</p>
            </>
          ) : (
            <>
              <p>noVNC seat</p>
              <p class="muted">Watch stream-only, or Open seat for an exclusive lease</p>
            </>
          )}
        </aside>
      </main>
    </div>
  );
}
