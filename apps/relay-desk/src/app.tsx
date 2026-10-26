import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  acquireSession,
  heartbeatSession,
  leaseSession,
  probeGateway,
  recycleSession,
  softReleaseSession,
} from "./gateway/client.ts";
import { loadSettings, saveSettings } from "./gateway/settings.ts";
import type { DeskSettings, SeatState } from "./gateway/types.ts";
import {
  closeSeatWindow,
  openSeatInBrowser,
  openSeatWindow,
} from "./seat/open-seat.ts";

const HEARTBEAT_MS = 45_000;

/**
 * Relay Desk — HITL operator shell.
 * Phase 1: gateway settings + lease / park / acquire / recycle + seat WebView.
 */
export function App() {
  const [settings, setSettings] = useState<DeskSettings>(() => loadSettings());
  const [probe, setProbe] = useState<string>("not checked");
  const [busy, setBusy] = useState(false);
  const [seat, setSeat] = useState<SeatState>({ phase: "idle" });
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
      await openSeatWindow(lease.vnc_url, () => {
        // Seat closed by user — soft-park if still leased.
        void softParkFromSeatClose();
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

  const onPark = async () => {
    if (!seat.sessionId) return;
    setBusy(true);
    try {
      await softReleaseSession(settings, seat.sessionId);
      await closeSeatWindow();
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
    if (!seat.sessionId) return;
    setBusy(true);
    try {
      const lease = await acquireSession(settings, seat.sessionId);
      setSeat({
        phase: "leased",
        sessionId: lease.session_id,
        vncUrl: lease.vnc_url,
        expiresAt: lease.expires_at,
      });
      await openSeatWindow(lease.vnc_url, () => {
        void softParkFromSeatClose();
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

  // Heartbeat while leased and the desk window is focused/visible.
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
        // Best-effort; may not finish in browsers, Tauri often allows it.
        void softReleaseSession(settingsRef.current, cur.sessionId);
      }
    };
    window.addEventListener("pagehide", onUnload);
    return () => window.removeEventListener("pagehide", onUnload);
  }, []);

  const statusLabel =
    seat.phase === "leased"
      ? `leased · ${seat.sessionId}`
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
              class="cta ghost"
              disabled={busy || seat.phase !== "parked" || !seat.sessionId}
              onClick={onAcquire}
            >
              Acquire
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
                onClick={() => void openSeatWindow(seat.vncUrl!)}
              >
                Focus seat
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
            <p class="mono muted break">
              {seat.vncUrl}
            </p>
          ) : (
            <p class="muted">
              Lease a worker to open noVNC (`autoconnect=1&resize=scale`).
            </p>
          )}
        </section>

        <aside class="seat-placeholder" aria-label="Seat stream">
          {seat.phase === "leased" && seat.vncUrl ? (
            <>
              <p>Seat window open</p>
              <p class="muted">Stream runs in the seat WebView — use Focus seat if buried.</p>
            </>
          ) : seat.phase === "parked" ? (
            <>
              <p>Parked (Firefox warm)</p>
              <p class="muted">Acquire to reclaim mouse/keyboard on the same session.</p>
            </>
          ) : (
            <>
              <p>noVNC seat</p>
              <p class="muted">WebView loads lease.vnc_url after Open seat</p>
            </>
          )}
        </aside>
      </main>
    </div>
  );
}
