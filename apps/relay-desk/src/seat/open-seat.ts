import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { withVncViewerParams } from "../gateway/vnc-url.ts";

const SEAT_LABEL = "seat";

export type SeatWindowMode = "lease" | "watch";

export interface OpenSeatOptions {
  /** Soft-park / cleanup when the WebView is destroyed (lease only). */
  onClosed?: () => void;
  mode?: SeatWindowMode;
}

let lastOpenedUrl: string | null = null;

function inTauri(): boolean {
  return Boolean(
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  );
}

function windowTitle(mode: SeatWindowMode): string {
  return mode === "watch" ? "Relay Desk · Watch" : "Relay Desk · Seat";
}

/**
 * Open (or focus) the seat WebView on the given vnc_url.
 * Recreates the window when the URL changes so Watch can switch targets.
 * Falls back to the system browser when not running under Tauri.
 */
export async function openSeatWindow(
  vncUrl: string,
  opts?: OpenSeatOptions
): Promise<void> {
  const url = withVncViewerParams(vncUrl);
  const mode = opts?.mode ?? "lease";
  const onClosed = opts?.onClosed;
  const title = windowTitle(mode);

  if (!inTauri()) {
    window.open(url, "relay-desk-seat", "noopener,noreferrer");
    lastOpenedUrl = url;
    return;
  }

  const existing = await WebviewWindow.getByLabel(SEAT_LABEL);
  if (existing) {
    if (lastOpenedUrl === url) {
      // setFocus alone does not restore a minimized window (esp. macOS).
      try {
        await existing.unminimize();
      } catch {
        /* ignore */
      }
      try {
        await existing.show();
      } catch {
        /* ignore */
      }
      try {
        await existing.setTitle(title);
      } catch {
        /* ignore */
      }
      await existing.setFocus();
      return;
    }
    try {
      await existing.close();
    } catch {
      /* ignore */
    }
  }

  lastOpenedUrl = url;

  const seat = new WebviewWindow(SEAT_LABEL, {
    url,
    title,
    width: 1280,
    height: 820,
    resizable: true,
    focus: true,
  });

  seat.once("tauri://error", (e) => {
    console.error("[seat] webview error", e);
  });

  if (onClosed) {
    seat.once("tauri://destroyed", () => {
      lastOpenedUrl = null;
      onClosed();
    });
  } else {
    seat.once("tauri://destroyed", () => {
      lastOpenedUrl = null;
    });
  }
}

export async function closeSeatWindow(): Promise<void> {
  if (!inTauri()) return;
  const existing = await WebviewWindow.getByLabel(SEAT_LABEL);
  if (existing) {
    await existing.close();
  }
  lastOpenedUrl = null;
}

/** Escape hatch if WebView cannot load noVNC. */
export async function openSeatInBrowser(vncUrl: string): Promise<void> {
  const url = withVncViewerParams(vncUrl);
  if (inTauri()) {
    await shellOpen(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
