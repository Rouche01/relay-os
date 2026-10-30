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
    trigger: {
      type: "object",
      additionalProperties: false,
      description:
        "Optional Spec v2.1 — exactly one of manual | schedule | poll",
      properties: {
        manual: { type: "boolean", description: "true for manual-only runs" },
        schedule: {
          type: "object",
          additionalProperties: false,
          properties: {
            cron: { type: "string" },
            timezone: { type: "string" },
          },
        },
        poll: {
          type: "object",
          additionalProperties: false,
          properties: {
            everyMs: { type: "number" },
            sourceStep: { type: "string" },
          },
        },
      },
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
              "Hard rule object with BOTH subject and companion. " +
              "notMatches/matches MUST be { notMatches|matches: \"${draft.text}\", pattern: \"https?://\" } — " +
              "never put the regex alone in notMatches. " +
              "Also: in/list, notIn/list, eq/value, neq/value, gt|gte|lt|lte/value.",
            properties: {
              in: {},
              notIn: {},
              list: {},
              matches: {
                description: 'Subject to match, usually "${draft.text}"',
              },
              notMatches: {
                description: 'Subject that must NOT match, usually "${draft.text}"',
              },
              pattern: {
                type: "string",
                description:
                  'Regex for matches/notMatches, e.g. "https?://". Required with matches/notMatches.',
              },
              eq: {},
              neq: {},
              value: {},
              gt: {},
              gte: {},
              lt: {},
              lte: {},
            },
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
          args: {
            type: "object",
            description:
              "Capability args — never empty. api.request: service, operation, params?; llm.generate: prompt, input?; human.approve|edit: show, prompt?",
          },
          forEach: {
            type: "string",
            description: "Whole-string ref to a list, e.g. ${steps.scout.output.body.posts}",
          },
          once: {
            type: "string",
            description:
              "Spec v2.1 idempotency key ref, e.g. ${item.id}. Required on irreversible forEach under schedule/poll.",
          },
          when: {
            description:
              "Spec v2.1 gate: ${...} ref or { eq|ne|in|exists }. False → skip step.",
          },
          retry: {
            type: "object",
            description:
              "Spec v2.1 — { max: totalAttempts, backoffMs? }. Irreversible + max>1 requires once.",
          },
          onError: {
            type: "string",
            enum: ["fail", "skip_item", "escalate_human"],
            description: "After retries exhausted (default fail).",
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
