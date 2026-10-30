# Spec v2.1 output schema

After a successful engine execute, `@relay/workflow-runtime` fail-closes when:

1. **`llm.generate` / `llm.extract`** carry `args.schema` and the result does
   not match (JSON Schema subset: `type`, `properties`, `required`, `items`,
   `enum`, `additionalProperties`, `minLength`, `minimum` / `maximum`).
2. **`outputs: [...]`** is set and the result object is missing any listed
   field.

LLM engine metadata (`provider`, `model`) is stripped before schema checks.

Schema / outputs mismatches count as execute failures: they are retried when
`retry` is set, then follow `onError` (`fail` | `skip_item` | `escalate_human`).

```yaml
- id: draft
  use: llm.generate
  outputs: [text, issue_number]
  args:
    prompt: "…"
    schema:
      type: object
      properties:
        text: { type: string }
        issue_number: { type: number }
      required: [text, issue_number]
```
