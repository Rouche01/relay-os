/**
 * JSON Schema for Spec v2 authoring bodies (YAML/JSON).
 *
 * Keep in sync with ./spec-v2.schema.json (same content; JSON is for editors /
 * external validators; this module is the runtime export).
 */

export type SpecV2JsonSchema = {
  $schema?: string;
  $id?: string;
  title?: string;
  description?: string;
  type?: string;
  required?: string[];
  properties?: Record<string, unknown>;
  $defs?: Record<string, unknown>;
  additionalProperties?: boolean;
  [key: string]: unknown;
};

/** Draft 2020-12 schema for Spec v2 authoring bodies. */
export const SPEC_V2_JSON_SCHEMA: SpecV2JsonSchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://relay.local/schemas/spec-v2.schema.json",
  "title": "Relay Spec v2",
  "description": "Ordered capability steps + goal-derived rules (YAML/JSON authoring body).",
  "type": "object",
  "additionalProperties": false,
  "required": ["goal", "steps"],
  "properties": {
    "goal": {
      "type": "string",
      "minLength": 1,
      "description": "Natural-language goal this Spec authorizes."
    },
    "connections": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "description": "Connection ref (e.g. reddit:default); never a secret."
      },
      "uniqueItems": true
    },
    "services": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "description": "Service descriptor id (e.g. reddit-public)."
      },
      "uniqueItems": true
    },
    "trigger": { "$ref": "#/$defs/trigger" },
    "budget": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "maxJobs": { "type": "integer", "minimum": 1 },
        "dryRun": { "type": "boolean" },
        "timeoutMs": { "type": "integer", "minimum": 1 }
      }
    },
    "rules": {
      "type": "array",
      "items": { "$ref": "#/$defs/rule" }
    },
    "steps": {
      "type": "array",
      "minItems": 1,
      "items": { "$ref": "#/$defs/step" }
    }
  },
  "$defs": {
    "refOrAny": {
      "description": "Literal or a whole-string Spec v2 ref ${path}"
    },
    "hardCheck": {
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["in", "list"],
          "properties": {
            "in": true,
            "list": true
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["notIn", "list"],
          "properties": {
            "notIn": true,
            "list": true
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["matches", "pattern"],
          "properties": {
            "matches": true,
            "pattern": { "type": "string", "minLength": 1 }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["notMatches", "pattern"],
          "properties": {
            "notMatches": true,
            "pattern": { "type": "string", "minLength": 1 }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["eq", "value"],
          "properties": {
            "eq": true,
            "value": true
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["neq", "value"],
          "properties": {
            "neq": true,
            "value": true
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["gt", "value"],
          "properties": {
            "gt": true,
            "value": { "type": "number" }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["gte", "value"],
          "properties": {
            "gte": true,
            "value": { "type": "number" }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["lt", "value"],
          "properties": {
            "lt": true,
            "value": { "type": "number" }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["lte", "value"],
          "properties": {
            "lte": true,
            "value": { "type": "number" }
          }
        }
      ]
    },
    "rule": {
      "type": "object",
      "required": ["id", "kind"],
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "description": { "type": "string" },
        "kind": { "type": "string", "enum": ["hard", "soft", "outcome"] }
      },
      "allOf": [
        {
          "if": {
            "properties": { "kind": { "const": "hard" } },
            "required": ["kind"]
          },
          "then": {
            "required": ["check"],
            "properties": {
              "check": { "$ref": "#/$defs/hardCheck" }
            }
          }
        },
        {
          "if": {
            "properties": { "kind": { "const": "soft" } },
            "required": ["kind"]
          },
          "then": {
            "required": ["judge"],
            "properties": {
              "judge": {
                "type": "object",
                "additionalProperties": false,
                "required": ["rubric"],
                "properties": {
                  "rubric": {
                    "type": "array",
                    "minItems": 1,
                    "items": { "type": "string", "minLength": 1 }
                  },
                  "minMean": { "type": "number" }
                }
              }
            }
          }
        },
        {
          "if": {
            "properties": { "kind": { "const": "outcome" } },
            "required": ["kind"]
          },
          "then": {
            "required": ["metric"],
            "properties": {
              "metric": {
                "type": "object",
                "additionalProperties": false,
                "required": ["name", "after"],
                "properties": {
                  "name": { "type": "string", "minLength": 1 },
                  "after": { "type": "string", "minLength": 1 },
                  "min": { "type": "number" },
                  "max": { "type": "number" }
                }
              }
            }
          }
        }
      ]
    },
    "step": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "use"],
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1,
          "pattern": "^[a-zA-Z_][\\w-]*$"
        },
        "use": {
          "type": "string",
          "minLength": 3,
          "description": "Catalog capability id engine.verb (e.g. api.request).",
          "pattern": "^[a-z]+\\.[a-z_]+$"
        },
        "args": {
          "type": "object",
          "description": "Capability args; values may be literals or ${...} refs."
        },
        "forEach": {
          "type": "string",
          "description": "List ref to fan out over, e.g. ${steps.scout.output.posts}."
        },
        "once": {
          "type": "string",
          "minLength": 1,
          "description": "Spec v2.1 idempotency key ref, e.g. ${item.id}. Duplicates skipped across runs."
        },
        "when": { "$ref": "#/$defs/when" },
        "retry": { "$ref": "#/$defs/retry" },
        "onError": {
          "type": "string",
          "enum": ["fail", "skip_item", "escalate_human"],
          "description": "Spec v2.1 — after retries exhausted (default fail)."
        },
        "enforce": {
          "type": "array",
          "items": { "type": "string", "minLength": 1 },
          "uniqueItems": true,
          "description": "Rule ids checked against this step's output."
        },
        "outputs": {
          "type": "array",
          "items": { "type": "string", "minLength": 1 },
          "uniqueItems": true
        },
        "sideEffectDowngrade": {
          "type": "object",
          "additionalProperties": false,
          "required": ["to", "reason"],
          "properties": {
            "to": { "type": "string", "enum": ["none", "reversible"] },
            "reason": { "type": "string", "minLength": 1 }
          }
        }
      }
    },
    "trigger": {
      "type": "object",
      "additionalProperties": false,
      "description": "Spec v2.1 — exactly one of manual | schedule | poll",
      "properties": {
        "manual": { "const": true },
        "schedule": {
          "type": "object",
          "additionalProperties": false,
          "required": ["cron"],
          "properties": {
            "cron": { "type": "string", "minLength": 1 },
            "timezone": { "type": "string", "minLength": 1 }
          }
        },
        "poll": {
          "type": "object",
          "additionalProperties": false,
          "required": ["everyMs", "sourceStep"],
          "properties": {
            "everyMs": { "type": "number", "exclusiveMinimum": 0 },
            "sourceStep": { "type": "string", "minLength": 1 }
          }
        }
      }
    },
    "when": {
      "description": "Spec v2.1 step gate — whole-string ${...} ref or eq/ne/in/exists (no general expressions)",
      "oneOf": [
        {
          "type": "string",
          "minLength": 1,
          "pattern": "^\\$\\{[a-zA-Z_][\\w.]*\\}$"
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["eq", "value"],
          "properties": { "eq": true, "value": true }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["ne", "value"],
          "properties": { "ne": true, "value": true }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["in", "list"],
          "properties": { "in": true, "list": true }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["exists"],
          "properties": { "exists": true }
        }
      ]
    },
    "retry": {
      "type": "object",
      "additionalProperties": false,
      "required": ["max"],
      "description": "Spec v2.1 — max = total attempts; optional backoffMs between tries",
      "properties": {
        "max": { "type": "integer", "minimum": 1 },
        "backoffMs": { "type": "number", "minimum": 0 }
      }
    }
  }
} as SpecV2JsonSchema;

/** Stable id for tooling / validators. */
export const SPEC_V2_SCHEMA_ID =
  "https://relay.local/schemas/spec-v2.schema.json";
