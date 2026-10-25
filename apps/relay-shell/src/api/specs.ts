/** Client for Relay Spec governance API (proxied to shell server). */

export type SpecBundleDto = {
  id: string;
  intent: {
    id: string;
    goal: string;
    slots: Record<string, string | number | boolean | null>;
    status: string;
  };
  spec: {
    id: string;
    version: number;
    status: string;
    goal: string;
    procedure: { appId: string; entrypoint: string };
    constraints: Array<{ id: string; description: string }>;
    allowedActions: Array<{
      id: string;
      description?: string;
      sideEffect?: string;
    }>;
    acceptance: Array<{
      id: string;
      description?: string;
      kind?: string;
    }>;
    hitlRequired?: Array<{
      id: string;
      description?: string;
      when?: string;
    }>;
    budget: { maxJobs?: number; dryRun?: boolean };
    actionBinding: string;
    frozenBy?: string;
  };
  savedAt: string;
  appId?: string;
  packId?: string;
  /** Present on create — catalog ids chosen for this Spec. */
  primitiveIds?: string[];
  /** Decide backend used on create (`heuristic` | `jev` | null if skipped). */
  decideBackend?: string | null;
};

const PRIMITIVES = new Set([
  "observe",
  "invoke",
  "read",
  "write",
  "navigate",
  "wait_human",
  "assert",
]);

export function packIdOf(bundle: SpecBundleDto): string {
  const c = bundle.spec.constraints.find((x) => x.id === "compose_pack");
  return c?.description || bundle.packId || bundle.appId || "—";
}

export function partitionActions(bundle: SpecBundleDto): {
  primitives: string[];
  aliases: string[];
} {
  const primitives: string[] = [];
  const aliases: string[] = [];
  for (const a of bundle.spec.allowedActions) {
    if (PRIMITIVES.has(a.id)) primitives.push(a.id);
    else aliases.push(a.id);
  }
  return { primitives, aliases };
}

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "content-type": "application/json", ...(opts?.headers || {}) },
    ...opts,
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: text };
  }
  if (!res.ok) {
    const err = body as { error?: string } | null;
    throw new Error(err?.error || res.statusText || "Request failed");
  }
  return body as T;
}

export function listSpecs(): Promise<{ records: SpecBundleDto[]; path: string }> {
  return api("/api/specs");
}

export function getSpec(id: string): Promise<SpecBundleDto> {
  return api(`/api/specs/${encodeURIComponent(id)}`);
}

export function createSpec(input: {
  goal: string;
  slots?: Record<string, string | number | boolean | null>;
}): Promise<SpecBundleDto> {
  return api("/api/specs", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function approveSpec(id: string): Promise<SpecBundleDto> {
  return api(`/api/specs/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    body: "{}",
  });
}

export function abortSpec(id: string): Promise<SpecBundleDto> {
  return api(`/api/specs/${encodeURIComponent(id)}/abort`, {
    method: "POST",
    body: "{}",
  });
}

const FLASH_PREFIX = "relay-shell:spec-create:";

/** Stash create-time decide metadata for Spec review (hash router has no state). */
export function stashCreateFlash(created: SpecBundleDto): void {
  try {
    sessionStorage.setItem(
      `${FLASH_PREFIX}${created.id}`,
      JSON.stringify({
        primitiveIds: created.primitiveIds ?? [],
        decideBackend: created.decideBackend ?? null,
        packId: created.packId ?? null,
      })
    );
  } catch {
    /* ignore quota / private mode */
  }
}

export function takeCreateFlash(id: string): {
  primitiveIds: string[];
  decideBackend: string | null;
  packId: string | null;
} | null {
  try {
    const raw = sessionStorage.getItem(`${FLASH_PREFIX}${id}`);
    if (!raw) return null;
    sessionStorage.removeItem(`${FLASH_PREFIX}${id}`);
    return JSON.parse(raw) as {
      primitiveIds: string[];
      decideBackend: string | null;
      packId: string | null;
    };
  } catch {
    return null;
  }
}
