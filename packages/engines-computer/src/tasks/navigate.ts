import type { ComputerEngine } from "../computer-engine.js";
import type { ComputerTaskResult } from "./types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Focus address bar → type URL → Enter → settle.
 * Shared by open_url and any future navigate recipes.
 */
export async function navigateToUrl(
  engine: ComputerEngine,
  url: string,
  settleMs = 2000
): Promise<ComputerTaskResult> {
  const trimmed = url.trim();
  if (!trimmed) {
    return { success: false, error: "open_url requires params.url" };
  }

  const focus = await engine.execute({
    type: "action",
    params: { action: { type: "key", text: "ctrl+l" } },
  });
  if (!focus.success) {
    return fail(engine, focus.error ?? "ctrl+l failed");
  }

  const typed = await engine.execute({
    type: "action",
    params: { action: { type: "type", text: trimmed } },
  });
  if (!typed.success) {
    return fail(engine, typed.error ?? "type url failed");
  }

  const go = await engine.execute({
    type: "action",
    params: { action: { type: "key", text: "Return" } },
  });
  if (!go.success) {
    return fail(engine, go.error ?? "Return failed");
  }

  if (settleMs > 0) {
    await sleep(settleMs);
  }

  return {
    success: true,
    vncUrl: engine.getVncUrl() ?? undefined,
    meta: { url: trimmed, settleMs },
  };
}

function fail(engine: ComputerEngine, error: string): ComputerTaskResult {
  const vncUrl = engine.getVncUrl() ?? undefined;
  return {
    success: false,
    error: vncUrl ? `${error} (vnc=${vncUrl})` : error,
    vncUrl,
  };
}
