import type {
  ComputerEngine,
  ComputerObserveElement,
} from "@relay/engines-computer";
import type { CaptureObservationResult } from "./types.js";

/** Screenshot-only observation (desktop desks). */
export async function captureScreenshotObservation(
  engine: ComputerEngine,
  iteration: number
): Promise<CaptureObservationResult> {
  const shot = await engine.execute({ type: "screenshot", params: {} });
  if (!shot.success) {
    return { ok: false, error: shot.error ?? "screenshot failed" };
  }
  const image = typeof shot.data?.image === "string" ? shot.data.image : "";
  if (!image) {
    return { ok: false, error: "screenshot returned no image" };
  }
  return {
    ok: true,
    observation: {
      imageBase64: image,
      at: new Date().toISOString(),
      meta: { iteration, observeMode: "screenshot" },
    },
  };
}

/** Screenshot + UIAutomator element tree (phone seats). */
export async function captureObserveObservation(
  engine: ComputerEngine,
  iteration: number,
  maxElements?: number
): Promise<CaptureObservationResult> {
  const obs = await engine.execute({
    type: "observe",
    params: maxElements != null ? { max_elements: maxElements } : {},
  });
  if (!obs.success) {
    return { ok: false, error: obs.error ?? "observe failed" };
  }
  const image = typeof obs.data?.image === "string" ? obs.data.image : "";
  if (!image) {
    return { ok: false, error: "observe returned no image" };
  }
  const elements = Array.isArray(obs.data?.elements)
    ? (obs.data.elements as ComputerObserveElement[])
    : undefined;
  return {
    ok: true,
    observation: {
      imageBase64: image,
      at: new Date().toISOString(),
      elements,
      meta: {
        iteration,
        observeMode: "observe",
        element_count: obs.data?.element_count,
        geometry: obs.data?.geometry,
      },
    },
  };
}
