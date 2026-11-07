/**
 * Capability slots — Spec names *what* is needed; bindings name *how*.
 *
 * Types + vocabulary seed for relay_capability_slots.plan.md (cs1).
 * Scaffold emit / SpecV2Body.slots wiring is cs2+ — ASAP Specs stay concrete.
 */

/** How a candidate satisfies a slot (open-services binding kinds). */
export type BindingKind =
  | "api"
  | "mcp"
  | "browser"
  | "computer"
  | "human"
  | "notify";

export const BINDING_KINDS: readonly BindingKind[] = [
  "api",
  "mcp",
  "browser",
  "computer",
  "human",
  "notify",
] as const;

/**
 * Honest availability of a candidate.
 * - live: catalog + connection ready for real side effects
 * - degraded: works with limits (notify-only, fixtures, partial API)
 * - available: usable path (computer/human) without claiming API live
 * - blocked: known but not usable now
 * - unknown: not probed yet
 */
export type BindingCandidateStatus =
  | "live"
  | "degraded"
  | "available"
  | "blocked"
  | "unknown";

export const BINDING_CANDIDATE_STATUSES: readonly BindingCandidateStatus[] = [
  "live",
  "degraded",
  "available",
  "blocked",
  "unknown",
] as const;

/** One way to satisfy a capability slot. */
export type BindingCandidate = {
  binding: BindingKind;
  status: BindingCandidateStatus;
  /** Catalog service id when this path uses a descriptor. */
  service?: string;
  /** Suggested connection ref (secrets live in connection store). */
  connection?: string;
  /** Why this status / why this candidate exists. */
  reason?: string;
  /** Lower = preferred when ranking (optional). */
  rank?: number;
};

/**
 * Named capability the Spec requires.
 * Stable across binding swaps; `resolved` is install-time (Ship).
 */
export type CapabilitySlot = {
  /** Capability id from vocabulary (e.g. `reddit.read`, `youtube.discover`). */
  id: string;
  /** Ops / outcomes this slot must cover (human-readable). */
  needs: string[];
  /** Ranked alternatives — never silently treat degraded as live. */
  candidates: BindingCandidate[];
  /**
   * Install resolution: connection ref or null until Ship.
   * Omit / null = unresolved.
   */
  resolved?: string | null;
  /** Scaffold hint: index into candidates[] preferred before operator confirm. */
  preferredCandidateIndex?: number;
};

/** Seed entry — maps intent language → slot id + default candidate templates. */
export type CapabilityVocabEntry = {
  id: string;
  label: string;
  description: string;
  needs: readonly string[];
  /**
   * Default candidates (status filled at scaffold from catalog/connection state).
   * Templates omit status; callers assign via {@link withCandidateStatus}.
   */
  defaultCandidates: readonly BindingCandidateTemplate[];
  /** Intent matchers (closed list — same spirit as scaffold INTENT_HINTS). */
  intentPatterns: readonly RegExp[];
};

export type BindingCandidateTemplate = Omit<BindingCandidate, "status"> & {
  /** Status when catalog/connection state is unknown at vocab-define time. */
  defaultStatus?: BindingCandidateStatus;
};

/** Small vocabulary seed (cs1). Expand with open-services; do not invent vendors here. */
export const CAPABILITY_VOCAB_SEED: readonly CapabilityVocabEntry[] = [
  {
    id: "scm.issues",
    label: "SCM issue triage",
    description: "List and comment on repository issues (GitHub-style).",
    needs: ["list open issues by label", "draft comment", "post comment with HITL"],
    defaultCandidates: [
      {
        binding: "api",
        service: "github",
        connection: "github:default",
        reason: "Curated GitHub descriptor",
        rank: 0,
        defaultStatus: "unknown",
      },
      {
        binding: "human",
        reason: "Operator posts manually at HITL",
        rank: 90,
        defaultStatus: "available",
      },
    ],
    intentPatterns: [
      /\bgithub\b/i,
      /\bgh\s+issue/i,
      /\brepos?\/[\w.-]+\/[\w.-]+/i,
      /\bbug\s+triage\b/i,
    ],
  },
  {
    id: "reddit.read",
    label: "Reddit read / scout",
    description: "Find threads or posts in subreddits for drafting replies.",
    needs: ["list or search posts", "read thread context"],
    defaultCandidates: [
      {
        binding: "api",
        service: "reddit-oauth",
        connection: "reddit:default",
        reason: "Official Reddit OAuth (often constrained)",
        rank: 0,
        defaultStatus: "unknown",
      },
      {
        binding: "api",
        service: "reddit-public",
        reason: "Public / limited Reddit read path",
        rank: 10,
        defaultStatus: "unknown",
      },
      {
        binding: "notify",
        service: "reddit-public",
        reason: "Notify-only / redditapis-style degraded path (CE lesson)",
        rank: 20,
        defaultStatus: "degraded",
      },
      {
        binding: "browser",
        reason: "Browser when API unavailable",
        rank: 40,
        defaultStatus: "available",
      },
      {
        binding: "computer",
        reason: "Computer-use seat when UI-only",
        rank: 50,
        defaultStatus: "available",
      },
      {
        binding: "human",
        reason: "Operator gathers threads at HITL",
        rank: 90,
        defaultStatus: "available",
      },
    ],
    intentPatterns: [/\breddit\b/i, /\bsubreddit\b/i],
  },
  {
    id: "youtube.discover",
    label: "YouTube creator discovery",
    description: "Find creators by audience/market and niche signals.",
    needs: [
      "search or list channels/creators",
      "audience or geo signals",
      "niche / topic labels",
    ],
    defaultCandidates: [
      {
        binding: "api",
        service: "youtube-data",
        connection: "youtube:default",
        reason: "YouTube Data API (not in ASAP curated pack yet)",
        rank: 0,
        defaultStatus: "blocked",
      },
      {
        binding: "api",
        service: "http-fetch",
        reason: "Generic HTTP fetch / scrape-adjacent (degraded)",
        rank: 20,
        defaultStatus: "degraded",
      },
      {
        binding: "computer",
        reason: "Operate YouTube UI on a seat",
        rank: 40,
        defaultStatus: "available",
      },
      {
        binding: "human",
        reason: "Operator supplies creator list at HITL",
        rank: 90,
        defaultStatus: "available",
      },
    ],
    intentPatterns: [/\byoutube\b/i, /\byt\s+creator/i, /\byoutuber/i],
  },
  {
    id: "slack.notify",
    label: "Slack notify",
    description: "Post a message to a Slack channel.",
    needs: ["post channel message"],
    defaultCandidates: [
      {
        binding: "api",
        service: "slack",
        connection: "slack:default",
        reason: "Curated Slack descriptor",
        rank: 0,
        defaultStatus: "unknown",
      },
      {
        binding: "human",
        reason: "Operator posts manually",
        rank: 90,
        defaultStatus: "available",
      },
    ],
    intentPatterns: [/\bslack\b/i],
  },
  {
    id: "notion.store",
    label: "Notion store",
    description: "Write structured records into Notion.",
    needs: ["create or update pages/rows"],
    defaultCandidates: [
      {
        binding: "api",
        service: "notion",
        connection: "notion:default",
        reason: "Curated Notion descriptor",
        rank: 0,
        defaultStatus: "unknown",
      },
      {
        binding: "human",
        reason: "Operator pastes records at HITL",
        rank: 90,
        defaultStatus: "available",
      },
    ],
    intentPatterns: [/\bnotion\b/i],
  },
  {
    id: "http.fetch",
    label: "HTTP fetch",
    description: "Fetch a URL or public HTTP resource.",
    needs: ["GET URL body"],
    defaultCandidates: [
      {
        binding: "api",
        service: "http-fetch",
        reason: "Curated http-fetch descriptor",
        rank: 0,
        defaultStatus: "unknown",
      },
      {
        binding: "human",
        reason: "Operator provides payload",
        rank: 90,
        defaultStatus: "available",
      },
    ],
    intentPatterns: [/\bhttp\.fetch\b/i, /\bfetch\s+(a\s+)?url\b/i],
  },
] as const;

const BINDING_KIND_SET = new Set<string>(BINDING_KINDS);
const STATUS_SET = new Set<string>(BINDING_CANDIDATE_STATUSES);

export function withCandidateStatus(
  template: BindingCandidateTemplate,
  status?: BindingCandidateStatus
): BindingCandidate {
  const { defaultStatus, ...rest } = template;
  return {
    ...rest,
    status: status ?? defaultStatus ?? "unknown",
  };
}

/** Materialize vocab default candidates with statuses applied. */
export function candidatesFromVocab(
  entry: CapabilityVocabEntry,
  statusByService?: ReadonlyMap<string, BindingCandidateStatus>
): BindingCandidate[] {
  return entry.defaultCandidates.map((t) => {
    const fromMap =
      t.service && statusByService?.get(t.service)
        ? statusByService.get(t.service)
        : undefined;
    return withCandidateStatus(t, fromMap);
  });
}

/** Build an unresolved slot from a vocab entry. */
export function slotFromVocab(
  entry: CapabilityVocabEntry,
  statusByService?: ReadonlyMap<string, BindingCandidateStatus>
): CapabilitySlot {
  const candidates = candidatesFromVocab(entry, statusByService);
  const preferredCandidateIndex = preferredLiveOrFirst(candidates);
  return {
    id: entry.id,
    needs: [...entry.needs],
    candidates,
    resolved: null,
    preferredCandidateIndex,
  };
}

/**
 * Prefer first live candidate; else first non-blocked; else 0.
 * Never prefers degraded over live when live exists.
 */
export function preferredLiveOrFirst(
  candidates: readonly BindingCandidate[]
): number {
  const live = candidates.findIndex((c) => c.status === "live");
  if (live >= 0) return live;
  const ok = candidates.findIndex(
    (c) => c.status === "available" || c.status === "degraded" || c.status === "unknown"
  );
  return ok >= 0 ? ok : 0;
}

/** Vocab entries whose intent patterns match. */
export function matchCapabilityVocab(
  intent: string,
  vocab: readonly CapabilityVocabEntry[] = CAPABILITY_VOCAB_SEED
): CapabilityVocabEntry[] {
  const text = intent.trim();
  if (!text) return [];
  return vocab.filter((e) => e.intentPatterns.some((p) => p.test(text)));
}

export function getCapabilityVocabEntry(
  id: string,
  vocab: readonly CapabilityVocabEntry[] = CAPABILITY_VOCAB_SEED
): CapabilityVocabEntry | undefined {
  return vocab.find((e) => e.id === id);
}

/** True when at least one candidate is not blocked. */
export function slotHasViableCandidate(slot: CapabilitySlot): boolean {
  return slot.candidates.some((c) => c.status !== "blocked");
}

export function checkBindingCandidateShape(
  value: unknown
): { ok: true; candidate: BindingCandidate } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: ["candidate must be an object"] };
  }
  const o = value as Record<string, unknown>;
  if (typeof o.binding !== "string" || !BINDING_KIND_SET.has(o.binding)) {
    errors.push(
      `binding must be one of ${BINDING_KINDS.join("|")} (got ${JSON.stringify(o.binding)})`
    );
  }
  if (typeof o.status !== "string" || !STATUS_SET.has(o.status)) {
    errors.push(
      `status must be one of ${BINDING_CANDIDATE_STATUSES.join("|")} (got ${JSON.stringify(o.status)})`
    );
  }
  if (o.service !== undefined && typeof o.service !== "string") {
    errors.push("service must be a string when present");
  }
  if (o.connection !== undefined && typeof o.connection !== "string") {
    errors.push("connection must be a string when present");
  }
  if (o.reason !== undefined && typeof o.reason !== "string") {
    errors.push("reason must be a string when present");
  }
  if (
    o.rank !== undefined &&
    (typeof o.rank !== "number" || !Number.isFinite(o.rank))
  ) {
    errors.push("rank must be a finite number when present");
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, candidate: value as BindingCandidate };
}

export function checkCapabilitySlotShape(
  value: unknown
): { ok: true; slot: CapabilitySlot } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: ["slot must be an object"] };
  }
  const o = value as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id.trim()) {
    errors.push("id must be a non-empty string");
  }
  if (!Array.isArray(o.needs) || o.needs.some((n) => typeof n !== "string")) {
    errors.push("needs must be an array of strings");
  }
  if (!Array.isArray(o.candidates)) {
    errors.push("candidates must be an array");
  } else {
    o.candidates.forEach((c, i) => {
      const r = checkBindingCandidateShape(c);
      if (!r.ok) {
        for (const e of r.errors) errors.push(`candidates[${i}]: ${e}`);
      }
    });
  }
  if (
    o.resolved !== undefined &&
    o.resolved !== null &&
    typeof o.resolved !== "string"
  ) {
    errors.push("resolved must be a string, null, or omitted");
  }
  if (
    o.preferredCandidateIndex !== undefined &&
    (typeof o.preferredCandidateIndex !== "number" ||
      !Number.isInteger(o.preferredCandidateIndex) ||
      o.preferredCandidateIndex < 0)
  ) {
    errors.push("preferredCandidateIndex must be a non-negative integer when present");
  }
  if (
    typeof o.preferredCandidateIndex === "number" &&
    Array.isArray(o.candidates) &&
    o.preferredCandidateIndex >= o.candidates.length
  ) {
    errors.push("preferredCandidateIndex out of candidates range");
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, slot: value as CapabilitySlot };
}
