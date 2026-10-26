import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { withVncViewerParams } from "../gateway/vnc-url.ts";

const SEAT_LABEL = "seat";

function inTauri(): boolean {
  return Boolean(
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  );
}

/**
 * Open (or focus) the seat WebView on the lease vnc_url.
 * Falls back to the system browser when not running under Tauri.
 */
export async function openSeatWindow(
  vncUrl: string,
  onClosed?: () => void
): Promise<void> {
  const url = withVncViewerParams(vncUrl);

  if (!inTauri()) {
    window.open(url, "relay-desk-seat", "noopener,noreferrer");
    return;
  }

  const existing = await WebviewWindow.getByLabel(SEAT_LABEL);
  if (existing) {
    await existing.setFocus();
    return;
  }

  const seat = new WebviewWindow(SEAT_LABEL, {
    url,
    title: "Relay Desk · Seat",
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
      onClosed();
    });
  }
}

export async function closeSeatWindow(): Promise<void> {
  if (!inTauri()) return;
  const existing = await WebviewWindow.getByLabel(SEAT_LABEL);
  if (existing) {
    await existing.close();
  }
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
