# Spec v2.1 `when`

Optional step gate. False → step skipped with evidence (`kind: "skip"`,
`reason: "when"`). No general expression language.

```yaml
steps:
  - id: draft
    use: llm.generate
    forEach: "${steps.scout.output.body}"
    when:
      eq: "${item.label}"
      value: bug
    args: { ... }
```

## Forms

| Shape | Meaning |
|-------|---------|
| `"${steps.x.output.ok}"` | Truthy after resolve (false/null/undefined/0/""/`[]` → skip) |
| `{ eq, value }` | Deep equality |
| `{ ne, value }` | Not equal |
| `{ in, list }` | Value ∈ list (list must resolve to an array) |
| `{ exists }` | Subject is not null/undefined |

Evaluated **per fanout child** (after the parent binds the list), before HITL /
`once` / execute.
