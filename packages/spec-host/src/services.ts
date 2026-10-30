import type { ServiceDescriptor, SpecV2Body } from "@relay/protocol";
import type { SelectServicesResult } from "./types.js";

/**
 * Pick descriptors whose ids appear on Spec.services from a host catalog.
 * Does not invent services — missing ids are reported.
 */
export function selectServicesForSpec(
  body: Pick<SpecV2Body, "services">,
  catalog: readonly ServiceDescriptor[]
): SelectServicesResult {
  const wanted = body.services ?? [];
  if (wanted.length === 0) {
    return { ok: true, services: [] };
  }
  const byId = new Map(catalog.map((s) => [s.id, s]));
  const missing: string[] = [];
  const services: ServiceDescriptor[] = [];
  for (const id of wanted) {
    const found = byId.get(id);
    if (!found) missing.push(id);
    else services.push(found);
  }
  if (missing.length) return { ok: false, missing };
  return { ok: true, services };
}
