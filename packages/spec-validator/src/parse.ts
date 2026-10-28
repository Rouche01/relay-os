import { parse as parseYaml } from "yaml";
import {
  checkSpecV2BodyShape,
  type SpecV2Body,
} from "@relay/protocol";

/**
 * Parse Spec v2 YAML into a body object (shape-checked, not fully validated).
 * Full checks: {@link validateSpecV2}.
 */
export function parseSpecV2Yaml(text: string): SpecV2Body {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (err) {
    throw new Error(
      `Invalid Spec v2 YAML: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const checked = checkSpecV2BodyShape(doc);
  if (!checked.ok) {
    throw new Error(`Invalid Spec v2 body:\n- ${checked.errors.join("\n- ")}`);
  }
  return checked.body;
}
