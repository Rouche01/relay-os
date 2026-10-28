/**
 * Flattened JSON Schema for LLM structured output.
 * Full authoring schema lives in @relay/protocol SPEC_V2_JSON_SCHEMA;
 * validator remains the source of truth after generation.
 */
export const SCAFFOLD_SPEC_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["goal", "steps"],
  properties: {
    goal: {
      type: "string",
      description: "Natural-language goal this Spec authorizes",
    },
    connections: {
      type: "array",
      items: { type: "string" },
      description: "Connection refs only (e.g. reddit:default); never secrets",
    },
    services: {
      type: "array",
      items: { type: "string" },
      description: "Service descriptor ids (e.g. reddit-public)",
    },
    budget: {
      type: "object",
      additionalProperties: false,
      properties: {
        maxJobs: {
          type: "integer",
          description: "Required when any step uses forEach",
        },
        dryRun: {
          type: "boolean",
          description: "Default true until operator goes live",
        },
        timeoutMs: { type: "integer" },
      },
    },
    rules: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "kind"],
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: ["hard", "soft", "outcome"] },
          description: { type: "string" },
          check: {
            type: "object",
            description:
              "Hard rule: one of in/list, notIn/list, matches/pattern, notMatches/pattern, eq/value, neq/value, gt|gte|lt|lte/value",
          },
          judge: {
            type: "object",
            description: "Soft rule: { rubric: string[], minMean?: number }",
          },
          metric: {
            type: "object",
            description:
              "Outcome rule: { name: string, after: string, min?: number, max?: number }",
          },
        },
      },
    },
    steps: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "use"],
        properties: {
          id: { type: "string" },
          use: {
            type: "string",
            description: "Catalog capability id (engine.verb)",
          },
          args: { type: "object" },
          forEach: {
            type: "string",
            description: "Whole-string ref to a list, e.g. ${steps.scout.output.body.posts}",
          },
          enforce: {
            type: "array",
            items: { type: "string" },
            description: "Rule ids checked against this step output",
          },
          outputs: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};
