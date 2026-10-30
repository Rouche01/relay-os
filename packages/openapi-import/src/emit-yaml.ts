import type { ServiceDescriptor } from "@relay/protocol";
import { stringify } from "yaml";

export type EmitYamlOptions = {
  /** Comment lines prepended (without leading #). */
  headerComments?: readonly string[];
};

/** Serialize a ServiceDescriptor to YAML (no secrets). */
export function emitServiceDescriptorYaml(
  descriptor: ServiceDescriptor,
  options: EmitYamlOptions = {}
): string {
  const header = (options.headerComments ?? [])
    .map((line) => `# ${line}`)
    .join("\n");

  // Prefer a stable field order for diffs.
  const doc: Record<string, unknown> = {
    id: descriptor.id,
  };
  if (descriptor.title) doc.title = descriptor.title;
  if (descriptor.description) doc.description = descriptor.description;
  doc.baseUrl = descriptor.baseUrl;
  if (descriptor.auth) doc.auth = descriptor.auth;
  doc.operations = descriptor.operations.map((op) => {
    const row: Record<string, unknown> = {
      id: op.id,
      method: op.method,
      path: op.path,
    };
    if (op.summary) row.summary = op.summary;
    if (op.irreversible === true) row.irreversible = true;
    if (op.params?.length) {
      row.params = op.params.map((p) => {
        const pr: Record<string, unknown> = {
          name: p.name,
          in: p.in,
        };
        if (p.required) pr.required = true;
        if (p.type) pr.type = p.type;
        if (p.description) pr.description = p.description;
        return pr;
      });
    }
    return row;
  });

  const body = stringify(doc, {
    lineWidth: 100,
    defaultStringType: "PLAIN",
    defaultKeyType: "PLAIN",
  });
  return header ? `${header}\n${body}` : body;
}
