import type { ServiceDescriptor } from "@relay/protocol";
import type { SpecV2ValidationIssue } from "@relay/spec-validator";

/** Capability gap the operator must resolve before scaffold can succeed. */
export type ScaffoldNeedKind = "service" | "connection" | "operation";

export type ScaffoldNeedAction =
  | "import_descriptor"
  | "add_connection"
  | "expand_operations";

export type ScaffoldNeed = {
  kind: ScaffoldNeedKind;
  /** Service id, connection ref, or `service.operation`. */
  id: string;
  reason: string;
  action: ScaffoldNeedAction;
};

const GAP_CODES = new Set([
  "unknown_service",
  "declared_service_missing",
  "unknown_connection",
  "unknown_operation",
]);

/**
 * Intent → likely service/connection hints (closed alias list).
 * Used for preflight before burning LLM repairs.
 */
const INTENT_HINTS: readonly {
  serviceId: string;
  connection?: string;
  label: string;
  patterns: readonly RegExp[];
}[] = [
  {
    serviceId: "github",
    connection: "github:default",
    label: "GitHub",
    patterns: [/\bgithub\b/i, /\bgh\s+issue/i, /\brepos?\/[\w.-]+\/[\w.-]+/i],
  },
  {
    serviceId: "slack",
    connection: "slack:default",
    label: "Slack",
    patterns: [/\bslack\b/i],
  },
  {
    serviceId: "notion",
    connection: "notion:default",
    label: "Notion",
    patterns: [/\bnotion\b/i],
  },
  {
    serviceId: "reddit-public",
    connection: "reddit:default",
    label: "Reddit",
    patterns: [/\breddit\b/i, /\bsubreddit\b/i],
  },
  {
    serviceId: "rss",
    label: "RSS/Atom",
    patterns: [/\brss\b/i, /\batom\s+feed\b/i],
  },
  {
    serviceId: "http-fetch",
    label: "HTTP fetch",
    patterns: [/\bhttp\.fetch\b/i, /\bfetch\s+(a\s+)?url\b/i],
  },
  // Not in curated pack — should surface as import_descriptor needs.
  {
    serviceId: "gmail",
    connection: "gmail:default",
    label: "Gmail",
    patterns: [/\bgmail\b/i, /\bgoogle\s*mail\b/i],
  },
  {
    serviceId: "sheets",
    connection: "sheets:default",
    label: "Google Sheets",
    patterns: [/\bgoogle\s*sheets?\b/i, /\bspreadsheet\b/i],
  },
  {
    serviceId: "trello",
    connection: "trello:default",
    label: "Trello",
    patterns: [/\btrello\b/i],
  },
  {
    serviceId: "jira",
    connection: "jira:default",
    label: "Jira",
    patterns: [/\bjira\b/i],
  },
  {
    serviceId: "stripe",
    connection: "stripe:default",
    label: "Stripe",
    patterns: [/\bstripe\b/i],
  },
];

export function isCapabilityGapCode(code: string): boolean {
  return GAP_CODES.has(code);
}

/** True when every error is a catalog/connection gap (safe to stop repairs). */
export function errorsAreOnlyCapabilityGaps(
  errors: readonly SpecV2ValidationIssue[]
): boolean {
  return (
    errors.length > 0 && errors.every((e) => isCapabilityGapCode(e.code))
  );
}

/** True when any error is a catalog/connection gap. */
export function errorsIncludeCapabilityGap(
  errors: readonly SpecV2ValidationIssue[]
): boolean {
  return errors.some((e) => isCapabilityGapCode(e.code));
}

/**
 * Derive structured needs from validator issues (unknown service/connection/op).
 */
export function needsFromValidationIssues(
  errors: readonly SpecV2ValidationIssue[]
): ScaffoldNeed[] {
  const out: ScaffoldNeed[] = [];
  const seen = new Set<string>();

  for (const e of errors) {
    if (e.code === "unknown_service" || e.code === "declared_service_missing") {
      const id = extractQuoted(e.message) ?? e.message;
      pushNeed(out, seen, {
        kind: "service",
        id,
        reason: e.message,
        action: "import_descriptor",
      });
    } else if (e.code === "unknown_connection") {
      const id = extractQuoted(e.message) ?? e.message;
      pushNeed(out, seen, {
        kind: "connection",
        id,
        reason: e.message,
        action: "add_connection",
      });
    } else if (e.code === "unknown_operation") {
      const service = extractQuoted(e.message, 0);
      const operation = extractQuoted(e.message, 1);
      const id =
        service && operation ? `${service}.${operation}` : (operation ?? e.message);
      pushNeed(out, seen, {
        kind: "operation",
        id,
        reason: e.message,
        action: "expand_operations",
      });
    }
  }
  return out;
}

/**
 * Preflight: intent wording implies services/connections missing from the catalog.
 * Does not call the LLM.
 */
export function needsFromIntent(
  intent: string,
  catalog: readonly ServiceDescriptor[],
  knownConnections?: readonly string[]
): ScaffoldNeed[] {
  const text = intent.trim();
  if (!text) return [];
  const byId = new Set(catalog.map((s) => s.id));
  const known =
    knownConnections !== undefined ? new Set(knownConnections) : null;
  const out: ScaffoldNeed[] = [];
  const seen = new Set<string>();

  for (const hint of INTENT_HINTS) {
    if (!hint.patterns.some((p) => p.test(text))) continue;

    if (!byId.has(hint.serviceId)) {
      pushNeed(out, seen, {
        kind: "service",
        id: hint.serviceId,
        reason: `Intent mentions ${hint.label}, but service ${JSON.stringify(hint.serviceId)} is not in the curated catalog`,
        action: "import_descriptor",
      });
      continue;
    }

    if (known && hint.connection && !known.has(hint.connection)) {
      pushNeed(out, seen, {
        kind: "connection",
        id: hint.connection,
        reason: `Intent needs ${hint.label} via connection ${JSON.stringify(hint.connection)}, which is not configured`,
        action: "add_connection",
      });
    }
  }
  return out;
}

export function formatNeedsMessage(needs: readonly ScaffoldNeed[]): string {
  if (!needs.length) return "Missing capabilities";
  const lines = needs.map((n) => {
    const action =
      n.action === "import_descriptor"
        ? "import descriptor"
        : n.action === "add_connection"
          ? "add connection"
          : "expand operations";
    return `- [${n.kind}] ${n.id} — ${action}: ${n.reason}`;
  });
  return [
    "Capability gap — resolve before scaffolding:",
    ...lines,
  ].join("\n");
}

function pushNeed(
  out: ScaffoldNeed[],
  seen: Set<string>,
  need: ScaffoldNeed
): void {
  const key = `${need.kind}:${need.id}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(need);
}

function extractQuoted(message: string, index = 0): string | undefined {
  const matches = [...message.matchAll(/"([^"]+)"/g)];
  return matches[index]?.[1];
}
