/**
 * Fixed engine capability catalog (Spec v2).
 *
 * Engines are closed code. Capabilities are fixed verbs per engine.
 * Specs name concrete calls via `use: "engine.capability"` (e.g. `api.request`).
 *
 * Side effects are derived from the capability (strictest by default).
 * For `api.request`, GET → none; POST/PUT/PATCH/DELETE → irreversible.
 *
 * `human` maps to EngineType `"none"` for manifests / AgentRuntime.
 * `code` and `comms` are not in this catalog (see generated-HITL plan).
 *
 * See docs/primitives.md (older primitive catalog) and the Desk Spec YC plan.
 */

import type { EngineType } from "./engines";
import type { SideEffectClass } from "./spec";

/** Engines that participate in Spec v2 capability steps. */
export type CatalogEngineId =
  | "llm"
  | "api"
  | "browser"
  | "computer"
  | "data"
  | "human";

export const CATALOG_ENGINE_IDS: readonly CatalogEngineId[] = [
  "llm",
  "api",
  "browser",
  "computer",
  "data",
  "human",
] as const;

/**
 * Map catalog engine → protocol EngineType for manifests / bindEngines.
 * `human` is HITL-only and uses `"none"`.
 */
export function catalogEngineToEngineType(
  engine: CatalogEngineId
): EngineType {
  return engine === "human" ? "none" : engine;
}

/** Capability verb within an engine (no dots). */
export type CapabilityVerb = string;

/** Fully qualified use id: `engine.verb` (e.g. `llm.generate`). */
export type CapabilityUseId = `${CatalogEngineId}.${string}`;

/** JSON-schema-ish arg field for validators / scaffolders. */
export type CapabilityArgType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array"
  | "any";

export type CapabilityArgDef = {
  type: CapabilityArgType;
  required?: boolean;
  description?: string;
  /** Allowed literal values when type is string. */
  enum?: readonly string[];
};

export type CapabilityArgSchema = Record<string, CapabilityArgDef>;

/**
 * How default sideEffect is decided for a capability.
 * - `fixed` — always `defaultSideEffect`
 * - `http_method` — inspect `args.method` (api.request)
 */
export type SideEffectRule =
  | { kind: "fixed"; sideEffect: SideEffectClass }
  | {
      kind: "http_method";
      /** Arg key that holds the HTTP method (default `method`). */
      methodArg?: string;
      /** Methods treated as none (read-only). Default GET/HEAD/OPTIONS. */
      safeMethods?: readonly string[];
    };

export type EngineCapabilityDef = {
  /** Fully qualified id (`llm.generate`). */
  id: CapabilityUseId;
  engine: CatalogEngineId;
  verb: string;
  description: string;
  args: CapabilityArgSchema;
  /**
   * Default side-effect class when no method-based rule applies,
   * or the fixed class for `fixed` rules.
   */
  defaultSideEffect: SideEffectClass;
  sideEffectRule: SideEffectRule;
  /**
   * When true, an irreversible path through this capability must be
   * preceded by a `human.*` step (validator invariant
   * `inv_hitl_before_irreversible`).
   */
  requiresHitlWhenIrreversible: boolean;
};

const LLM_ARGS_GENERATE: CapabilityArgSchema = {
  prompt: {
    type: "string",
    required: true,
    description: "Generation prompt (may contain ${...} refs)",
  },
  system: { type: "string", description: "Optional system instruction" },
  schema: {
    type: "object",
    description: "Optional JSON schema for structured output",
  },
};

const LLM_ARGS_CLASSIFY: CapabilityArgSchema = {
  input: {
    type: "any",
    required: true,
    description: "Value to classify",
  },
  labels: {
    type: "array",
    required: true,
    description: "Allowed class labels",
  },
};

const LLM_ARGS_EXTRACT: CapabilityArgSchema = {
  input: {
    type: "any",
    required: true,
    description: "Source text or object",
  },
  schema: {
    type: "object",
    required: true,
    description: "Shape of fields to extract",
  },
};

const LLM_ARGS_JUDGE: CapabilityArgSchema = {
  input: {
    type: "any",
    required: true,
    description: "Artifact under evaluation",
  },
  rubric: {
    type: "array",
    required: true,
    description: "Dimension names or scored criteria",
  },
  minMean: {
    type: "number",
    description: "Optional pass threshold on mean score",
  },
};

const API_REQUEST_ARGS: CapabilityArgSchema = {
  service: {
    type: "string",
    required: true,
    description: "Service descriptor id (e.g. reddit-public)",
  },
  operation: {
    type: "string",
    required: true,
    description: "Operation id within the service descriptor",
  },
  method: {
    type: "string",
    description: "HTTP method; if omitted, taken from the service descriptor",
    enum: ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"],
  },
  params: {
    type: "object",
    description: "Operation parameters (path/query/body)",
  },
  connection: {
    type: "string",
    description: "Connection ref (e.g. reddit:default); never a secret",
  },
};

const BROWSER_NAVIGATE_ARGS: CapabilityArgSchema = {
  url: { type: "string", required: true, description: "Absolute URL" },
};

const BROWSER_READ_ARGS: CapabilityArgSchema = {
  selector: {
    type: "string",
    description: "CSS/xpath selector; omit for full page text/HTML",
  },
  as: {
    type: "string",
    enum: ["text", "html", "value", "attribute"],
    description: "What to read (default text)",
  },
  attribute: {
    type: "string",
    description: "Attribute name when as=attribute",
  },
};

const BROWSER_CLICK_ARGS: CapabilityArgSchema = {
  selector: {
    type: "string",
    required: true,
    description: "Element to click",
  },
};

const BROWSER_TYPE_ARGS: CapabilityArgSchema = {
  selector: {
    type: "string",
    required: true,
    description: "Input to type into",
  },
  text: { type: "string", required: true, description: "Text to type" },
  clear: {
    type: "boolean",
    description: "Clear field before typing (default true)",
  },
};

const BROWSER_SUBMIT_ARGS: CapabilityArgSchema = {
  selector: {
    type: "string",
    description: "Form or submit control; omit to submit focused form",
  },
};

const COMPUTER_OBSERVE_ARGS: CapabilityArgSchema = {
  query: {
    type: "string",
    description: "Optional focus hint for the observation",
  },
};

const COMPUTER_ACT_ARGS: CapabilityArgSchema = {
  action: {
    type: "string",
    required: true,
    description: "Desktop action kind (click, type, key, …)",
  },
  params: {
    type: "object",
    description: "Action parameters (coordinates, text, keys)",
  },
};

const DATA_KEY_ARGS: CapabilityArgSchema = {
  store: {
    type: "string",
    required: true,
    description: "Logical store id",
  },
  key: { type: "string", description: "Record key when applicable" },
  value: { type: "any", description: "Value for put/append" },
  query: {
    type: "object",
    description: "Filter for query",
  },
};

const HUMAN_APPROVE_ARGS: CapabilityArgSchema = {
  show: {
    type: "any",
    required: true,
    description: "Payload shown to the human",
  },
  prompt: {
    type: "string",
    description: "Optional prompt override",
  },
};

const HUMAN_EDIT_ARGS: CapabilityArgSchema = {
  show: {
    type: "any",
    required: true,
    description: "Draft or artifact to edit",
  },
  prompt: { type: "string", description: "Optional edit prompt" },
};

const HUMAN_CHOOSE_ARGS: CapabilityArgSchema = {
  show: {
    type: "any",
    required: true,
    description: "Context for the choice",
  },
  options: {
    type: "array",
    required: true,
    description: "Allowed choices",
  },
  prompt: { type: "string", description: "Optional choice prompt" },
};

function cap(
  engine: CatalogEngineId,
  verb: string,
  description: string,
  args: CapabilityArgSchema,
  defaultSideEffect: SideEffectClass,
  sideEffectRule: SideEffectRule,
  requiresHitlWhenIrreversible = defaultSideEffect === "irreversible"
): EngineCapabilityDef {
  return {
    id: `${engine}.${verb}` as CapabilityUseId,
    engine,
    verb,
    description,
    args,
    defaultSideEffect,
    sideEffectRule,
    requiresHitlWhenIrreversible,
  };
}

/** Canonical fixed catalog — closed set for Spec v2 validators / scaffolders. */
export const ENGINE_CAPABILITY_CATALOG: readonly EngineCapabilityDef[] = [
  cap(
    "llm",
    "generate",
    "Generate text or structured content",
    LLM_ARGS_GENERATE,
    "none",
    { kind: "fixed", sideEffect: "none" },
    false
  ),
  cap(
    "llm",
    "classify",
    "Classify input into labeled buckets",
    LLM_ARGS_CLASSIFY,
    "none",
    { kind: "fixed", sideEffect: "none" },
    false
  ),
  cap(
    "llm",
    "extract",
    "Extract structured fields from input",
    LLM_ARGS_EXTRACT,
    "none",
    { kind: "fixed", sideEffect: "none" },
    false
  ),
  cap(
    "llm",
    "judge",
    "Score an artifact against a rubric",
    LLM_ARGS_JUDGE,
    "none",
    { kind: "fixed", sideEffect: "none" },
    false
  ),

  cap(
    "api",
    "request",
    "HTTP request against a service descriptor operation",
    API_REQUEST_ARGS,
    "irreversible",
    {
      kind: "http_method",
      methodArg: "method",
      safeMethods: ["GET", "HEAD", "OPTIONS"],
    },
    true
  ),

  cap(
    "browser",
    "navigate",
    "Open a URL in the browser session",
    BROWSER_NAVIGATE_ARGS,
    "none",
    { kind: "fixed", sideEffect: "none" },
    false
  ),
  cap(
    "browser",
    "read",
    "Read page text, HTML, or an element value",
    BROWSER_READ_ARGS,
    "none",
    { kind: "fixed", sideEffect: "none" },
    false
  ),
  cap(
    "browser",
    "click",
    "Click an element (may navigate; not a form submit)",
    BROWSER_CLICK_ARGS,
    "reversible",
    { kind: "fixed", sideEffect: "reversible" },
    false
  ),
  cap(
    "browser",
    "type",
    "Type into an input field",
    BROWSER_TYPE_ARGS,
    "reversible",
    { kind: "fixed", sideEffect: "reversible" },
    false
  ),
  cap(
    "browser",
    "submit",
    "Submit a form (irreversible by default)",
    BROWSER_SUBMIT_ARGS,
    "irreversible",
    { kind: "fixed", sideEffect: "irreversible" },
    true
  ),

  cap(
    "computer",
    "observe",
    "Screenshot / observe the desktop session",
    COMPUTER_OBSERVE_ARGS,
    "none",
    { kind: "fixed", sideEffect: "none" },
    false
  ),
  cap(
    "computer",
    "act",
    "Perform OS-level input on the desktop (irreversible by default)",
    COMPUTER_ACT_ARGS,
    "irreversible",
    { kind: "fixed", sideEffect: "irreversible" },
    true
  ),

  cap(
    "data",
    "get",
    "Read a record from a logical store",
    DATA_KEY_ARGS,
    "none",
    { kind: "fixed", sideEffect: "none" },
    false
  ),
  cap(
    "data",
    "put",
    "Create or overwrite a record (irreversible by default)",
    { ...DATA_KEY_ARGS, value: { type: "any", required: true, description: "Value to store" } },
    "irreversible",
    { kind: "fixed", sideEffect: "irreversible" },
    true
  ),
  cap(
    "data",
    "query",
    "Query records from a logical store",
    DATA_KEY_ARGS,
    "none",
    { kind: "fixed", sideEffect: "none" },
    false
  ),
  cap(
    "data",
    "append",
    "Append to a list/log in a logical store",
    {
      store: DATA_KEY_ARGS.store!,
      value: { type: "any", required: true, description: "Value to append" },
    },
    "reversible",
    { kind: "fixed", sideEffect: "reversible" },
    false
  ),

  cap(
    "human",
    "approve",
    "Pause for Approve / Abort",
    HUMAN_APPROVE_ARGS,
    "none",
    { kind: "fixed", sideEffect: "none" },
    false
  ),
  cap(
    "human",
    "edit",
    "Pause for Edit (revised artifact)",
    HUMAN_EDIT_ARGS,
    "none",
    { kind: "fixed", sideEffect: "none" },
    false
  ),
  cap(
    "human",
    "choose",
    "Pause for a choice among options",
    HUMAN_CHOOSE_ARGS,
    "none",
    { kind: "fixed", sideEffect: "none" },
    false
  ),
] as const;

const BY_ID = new Map<string, EngineCapabilityDef>(
  ENGINE_CAPABILITY_CATALOG.map((c) => [c.id, c])
);

const SAFE_HTTP = new Set(["GET", "HEAD", "OPTIONS"]);

/** All fully qualified capability ids. */
export const ENGINE_CAPABILITY_IDS: readonly CapabilityUseId[] =
  ENGINE_CAPABILITY_CATALOG.map((c) => c.id);

export function isCatalogEngineId(value: string): value is CatalogEngineId {
  return (CATALOG_ENGINE_IDS as readonly string[]).includes(value);
}

export function isCapabilityUseId(value: string): value is CapabilityUseId {
  return BY_ID.has(value);
}

export function getCapability(
  useId: string
): EngineCapabilityDef | undefined {
  return BY_ID.get(useId);
}

/**
 * Parse `engine.verb` use strings.
 * Returns undefined when the string is malformed or unknown.
 */
export function parseCapabilityUse(
  use: string
):
  | { ok: true; capability: EngineCapabilityDef }
  | { ok: false; error: string } {
  const trimmed = use.trim();
  if (!trimmed) {
    return { ok: false, error: "Empty capability use id" };
  }
  const dot = trimmed.indexOf(".");
  if (dot <= 0 || dot === trimmed.length - 1) {
    return {
      ok: false,
      error: `Capability use must be "engine.verb" (got ${JSON.stringify(trimmed)})`,
    };
  }
  const engine = trimmed.slice(0, dot);
  if (!isCatalogEngineId(engine)) {
    return {
      ok: false,
      error: `Unknown catalog engine ${JSON.stringify(engine)} (catalog: ${CATALOG_ENGINE_IDS.join(", ")})`,
    };
  }
  const capability = BY_ID.get(trimmed);
  if (!capability) {
    const verbs = ENGINE_CAPABILITY_CATALOG.filter((c) => c.engine === engine)
      .map((c) => c.verb)
      .join(", ");
    return {
      ok: false,
      error: `Unknown capability ${JSON.stringify(trimmed)} (engine ${engine} verbs: ${verbs})`,
    };
  }
  return { ok: true, capability };
}

export type ResolveSideEffectArgs = {
  /** Step args; used for http_method rules. */
  args?: Record<string, unknown>;
  /**
   * Method from the service descriptor when args.method is omitted.
   * api.request only.
   */
  descriptorMethod?: string;
};

/**
 * Derive side-effect class for a capability invocation.
 * Strictest default: unknown / missing HTTP method → irreversible for api.request.
 */
export function resolveCapabilitySideEffect(
  capability: EngineCapabilityDef,
  options?: ResolveSideEffectArgs
): SideEffectClass {
  const rule = capability.sideEffectRule;
  if (rule.kind === "fixed") {
    return rule.sideEffect;
  }

  const methodArg = rule.methodArg ?? "method";
  const raw =
    options?.args?.[methodArg] ?? options?.descriptorMethod ?? undefined;
  if (typeof raw !== "string" || !raw.trim()) {
    // Fail closed: unknown method is treated as irreversible.
    return "irreversible";
  }
  const method = raw.trim().toUpperCase();
  const safe = new Set(
    (rule.safeMethods ?? [...SAFE_HTTP]).map((m) => m.toUpperCase())
  );
  return safe.has(method) ? "none" : "irreversible";
}

/**
 * True when this capability invocation is irreversible under
 * {@link resolveCapabilitySideEffect} and requires a prior human gate.
 */
export function capabilityNeedsHitl(
  capability: EngineCapabilityDef,
  options?: ResolveSideEffectArgs
): boolean {
  if (!capability.requiresHitlWhenIrreversible) return false;
  return resolveCapabilitySideEffect(capability, options) === "irreversible";
}

/** Capabilities for one engine (stable catalog order). */
export function capabilitiesForEngine(
  engine: CatalogEngineId
): EngineCapabilityDef[] {
  return ENGINE_CAPABILITY_CATALOG.filter((c) => c.engine === engine);
}

/**
 * Named invariant ids the catalog implies for validators / future proofs.
 * Statements are one-liners; enforcement lives in @relay/spec-validator.
 */
export const CATALOG_INVARIANTS = {
  inv_no_unbound_capability:
    "Every step.use is a known engine.capability in ENGINE_CAPABILITY_CATALOG",
  inv_hitl_before_irreversible:
    "Every path to an irreversible capability invocation passes through a human.* step",
  inv_api_method_side_effect:
    "api.request sideEffect is none for GET/HEAD/OPTIONS and irreversible otherwise (missing method → irreversible)",
} as const;

export type CatalogInvariantId = keyof typeof CATALOG_INVARIANTS;
