import type { ComputerActionPayload } from "@relay/engines-computer";
import type { SeatObservation } from "./types.js";

/** Default screen fingerprint: element list, else image length + edges. */
export function defaultScreenSignature(observation: SeatObservation): string {
  const elements = observation.elements;
  if (elements && elements.length > 0) {
    const lines = elements.slice(0, 40).map((el) => {
      const ref = el.ref != null ? String(el.ref) : "";
      const text = typeof el.text === "string" ? el.text : "";
      const desc =
        typeof el.content_desc === "string" ? el.content_desc : "";
      const clickable = el.clickable === true ? "1" : "0";
      return `${ref}|${text}|${desc}|${clickable}`;
    });
    return `el:${lines.slice().sort().join("\n")}`;
  }
  const img = observation.imageBase64 ?? "";
  const head = img.slice(0, 32);
  const tail = img.length > 32 ? img.slice(-32) : "";
  return `img:${img.length}:${head}:${tail}`;
}

/** Stable fingerprint for same-action streak comparison. */
export function actionFingerprint(action: ComputerActionPayload): string {
  const parts: string[] = [String(action.type)];
  const a = action as ComputerActionPayload & {
    ref?: string;
    x?: number;
    y?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
    text?: string;
    package?: string;
    uri?: string;
    direction?: string;
    amount?: number;
    duration_ms?: number;
  };
  if (a.ref != null) parts.push(`ref=${JSON.stringify(a.ref)}`);
  if (a.x != null) parts.push(`x=${a.x}`);
  if (a.y != null) parts.push(`y=${a.y}`);
  if (a.x1 != null) parts.push(`x1=${a.x1}`);
  if (a.y1 != null) parts.push(`y1=${a.y1}`);
  if (a.x2 != null) parts.push(`x2=${a.x2}`);
  if (a.y2 != null) parts.push(`y2=${a.y2}`);
  if (a.text != null) parts.push(`text=${JSON.stringify(a.text)}`);
  if (a.package != null) parts.push(`package=${JSON.stringify(a.package)}`);
  if (a.uri != null) parts.push(`uri=${JSON.stringify(a.uri)}`);
  if (a.direction != null) parts.push(`direction=${JSON.stringify(a.direction)}`);
  if (a.amount != null) parts.push(`amount=${a.amount}`);
  if (a.duration_ms != null) parts.push(`duration_ms=${a.duration_ms}`);
  return parts.join("&");
}
