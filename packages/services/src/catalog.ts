/**
 * Curated service ids shipped under descriptors/.
 * Order is stable for prompt / Desk catalog listings.
 */
export const CURATED_SERVICE_IDS = [
  "reddit-public",
  "reddit-oauth",
  "github",
  "slack",
  "http-fetch",
  "rss",
  "notion",
] as const;

export type CuratedServiceId = (typeof CURATED_SERVICE_IDS)[number];

/** Connection refs operators typically need for each curated service. */
export const CURATED_CONNECTION_HINTS: Readonly<
  Record<CuratedServiceId, readonly string[]>
> = {
  "reddit-public": ["reddit:default"],
  "reddit-oauth": ["reddit:default"],
  github: ["github:default"],
  slack: ["slack:default"],
  "http-fetch": [],
  rss: [],
  notion: ["notion:default"],
};

/** Deduped connection refs across the curated pack (for validator knownConnections). */
export function curatedKnownConnections(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of CURATED_SERVICE_IDS) {
    for (const ref of CURATED_CONNECTION_HINTS[id]) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      out.push(ref);
    }
  }
  return out;
}

export function isCuratedServiceId(id: string): id is CuratedServiceId {
  return (CURATED_SERVICE_IDS as readonly string[]).includes(id);
}
