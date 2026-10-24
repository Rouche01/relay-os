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
    allowedActions: Array<{ id: string; description?: string }>;
    acceptance: Array<{ id: string }>;
    budget: { maxJobs?: number; dryRun?: boolean };
    actionBinding: string;
    frozenBy?: string;
  };
  savedAt: string;
  appId?: string;
  packId?: string;
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
