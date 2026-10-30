/**
 * Spec v2.1 — runtime output checks (fail closed).
 *
 * 1. `llm.generate` / `llm.extract` `args.schema` (JSON Schema subset)
 * 2. Declared step `outputs` field names present on the result object
 *
 * No Ajv dependency — closed subset: type, properties, required, items, enum,
 * additionalProperties (boolean), minLength, minimum / maximum.
 */

export type OutputSchemaIssue = {
  path: string;
  message: string;
};

const LLM_META_KEYS = new Set(["provider", "model"]);

/** Strip llm engine metadata before schema checks. */
export function stripLlmMeta(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!LLM_META_KEYS.has(k)) out[k] = v;
  }
  return out;
}

export function validateDeclaredOutputs(
  value: unknown,
  outputs: readonly string[]
): OutputSchemaIssue[] {
  if (!outputs.length) return [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [
      {
        path: "",
        message: `declared outputs require an object result (got ${typeName(value)})`,
      },
    ];
  }
  const obj = value as Record<string, unknown>;
  const issues: OutputSchemaIssue[] = [];
  for (const name of outputs) {
    if (!(name in obj) || obj[name] === undefined) {
      issues.push({
        path: name,
        message: `missing declared output field ${JSON.stringify(name)}`,
      });
    }
  }
  return issues;
}

/**
 * Validate `value` against a JSON Schema-like object (subset).
 */
export function validateAgainstJsonSchema(
  value: unknown,
  schema: Record<string, unknown>,
  path = ""
): OutputSchemaIssue[] {
  const issues: OutputSchemaIssue[] = [];
  const type = schema.type;

  if (typeof type === "string") {
    if (!matchesType(value, type)) {
      issues.push({
        path,
        message: `expected type ${type}, got ${typeName(value)}`,
      });
      return issues;
    }
  }

  if (Array.isArray(schema.enum)) {
    const ok = schema.enum.some((e) => deepEqual(e, value));
    if (!ok) {
      issues.push({
        path,
        message: `value not in enum`,
      });
    }
  }

  if (type === "string" && typeof value === "string") {
    if (
      typeof schema.minLength === "number" &&
      value.length < schema.minLength
    ) {
      issues.push({
        path,
        message: `string shorter than minLength ${schema.minLength}`,
      });
    }
  }

  if (
    (type === "number" || type === "integer") &&
    typeof value === "number"
  ) {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      issues.push({
        path,
        message: `number below minimum ${schema.minimum}`,
      });
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      issues.push({
        path,
        message: `number above maximum ${schema.maximum}`,
      });
    }
  }

  if (type === "array" && Array.isArray(value)) {
    const itemSchema = schema.items;
    if (itemSchema && typeof itemSchema === "object" && !Array.isArray(itemSchema)) {
      value.forEach((item, i) => {
        issues.push(
          ...validateAgainstJsonSchema(
            item,
            itemSchema as Record<string, unknown>,
            joinPath(path, String(i))
          )
        );
      });
    }
  }

  if (type === "object" || (type === undefined && schema.properties)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      if (type === "object") {
        // already reported via matchesType
      }
      return issues;
    }
    const obj = value as Record<string, unknown>;
    const props =
      schema.properties &&
      typeof schema.properties === "object" &&
      !Array.isArray(schema.properties)
        ? (schema.properties as Record<string, Record<string, unknown>>)
        : undefined;

    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key !== "string") continue;
        if (!(key in obj) || obj[key] === undefined) {
          issues.push({
            path: joinPath(path, key),
            message: `missing required property ${JSON.stringify(key)}`,
          });
        }
      }
    }

    if (props) {
      for (const [key, propSchema] of Object.entries(props)) {
        if (!(key in obj) || obj[key] === undefined) continue;
        issues.push(
          ...validateAgainstJsonSchema(
            obj[key],
            propSchema,
            joinPath(path, key)
          )
        );
      }
    }

    if (schema.additionalProperties === false && props) {
      for (const key of Object.keys(obj)) {
        if (!(key in props)) {
          issues.push({
            path: joinPath(path, key),
            message: `additional property ${JSON.stringify(key)} not allowed`,
          });
        }
      }
    }
  }

  return issues;
}

export type ValidateStepOutputOptions = {
  use: string;
  /** Resolved step args (schema may live here). */
  args: Record<string, unknown>;
  outputs?: readonly string[];
  output: unknown;
};

/**
 * Collect all output issues for a completed step execute.
 */
export function validateStepOutput(
  options: ValidateStepOutputOptions
): OutputSchemaIssue[] {
  const issues: OutputSchemaIssue[] = [];
  const use = options.use.trim();
  const isLlmStructured =
    use === "llm.generate" ||
    use === "llm.extract" ||
    use.endsWith(".generate") ||
    use.endsWith(".extract");

  const schema =
    options.args.schema &&
    typeof options.args.schema === "object" &&
    !Array.isArray(options.args.schema)
      ? (options.args.schema as Record<string, unknown>)
      : undefined;

  if (isLlmStructured && schema) {
    const payload = stripLlmMeta(options.output);
    issues.push(...validateAgainstJsonSchema(payload, schema));
  }

  if (options.outputs?.length) {
    issues.push(
      ...validateDeclaredOutputs(stripLlmMeta(options.output), options.outputs)
    );
  }

  return issues;
}

export function formatOutputSchemaIssues(issues: OutputSchemaIssue[]): string {
  return issues
    .map((i) => (i.path ? `${i.path}: ${i.message}` : i.message))
    .join("; ");
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return !!value && typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function joinPath(base: string, key: string): string {
  return base ? `${base}.${key}` : key;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
