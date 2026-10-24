/**
 * Intent — natural-language (and optional structured) goal that compiles into a Spec.
 *
 * Intent is the entry. Spec is the frozen authority. Compilers (template v1,
 * later smarter) turn Intent → draft Spec; humans freeze before irreversible act.
 */

export type IntentStatus = "open" | "compiled" | "abandoned";

/**
 * Structured slots for template compilers (engage v1, etc.).
 * Opaque to the protocol — apps define keys they understand.
 */
export type IntentSlots = Record<string, string | number | boolean | null>;

export interface Intent {
  id: string;
  status: IntentStatus;
  /** What the user asked for, in their words. */
  goal: string;
  /** Optional structured fields for Intent→Spec template fill. */
  slots: IntentSlots;
  /** Spec produced from this Intent, when compiled. */
  specId?: string;
  createdAt: string;
  updatedAt: string;
}

export type CreateIntentInput = {
  goal: string;
  slots?: IntentSlots;
  id?: string;
  createdAt?: string;
};

function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Create an open Intent ready to compile into a Spec. */
export function createIntent(input: CreateIntentInput): Intent {
  const goal = input.goal.trim();
  if (!goal) {
    throw new Error("Intent goal must be non-empty");
  }
  const now = input.createdAt ?? new Date().toISOString();
  return {
    id: input.id ?? newId("intent"),
    status: "open",
    goal,
    slots: input.slots ?? {},
    createdAt: now,
    updatedAt: now,
  };
}

/** Attach a compiled Spec id and mark Intent compiled. */
export function markIntentCompiled(intent: Intent, specId: string): Intent {
  if (!specId.trim()) {
    throw new Error("specId must be non-empty");
  }
  if (intent.status === "abandoned") {
    throw new Error("Cannot compile an abandoned Intent");
  }
  return {
    ...intent,
    status: "compiled",
    specId: specId.trim(),
    updatedAt: new Date().toISOString(),
  };
}

export function abandonIntent(intent: Intent): Intent {
  if (intent.status === "abandoned") {
    return intent;
  }
  return {
    ...intent,
    status: "abandoned",
    updatedAt: new Date().toISOString(),
  };
}
