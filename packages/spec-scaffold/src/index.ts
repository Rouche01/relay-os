export {
  formatCatalogForPrompt,
  formatServicesForPrompt,
  buildSystemPrompt,
  buildDraftUserPrompt,
  buildRepairUserPrompt,
} from "./prompt.js";
export {
  needsFromIntent,
  needsFromValidationIssues,
  formatNeedsMessage,
  errorsIncludeCapabilityGap,
  errorsAreOnlyCapabilityGaps,
  isCapabilityGapCode,
} from "./needs.js";
export { SCAFFOLD_SPEC_JSON_SCHEMA } from "./schema.js";
export { scaffoldSpec, specBodyToYaml } from "./scaffold.js";
export type {
  ScaffoldAttempt,
  ScaffoldResult,
  ScaffoldSpecOptions,
  ScaffoldNeed,
  ScaffoldNeedAction,
  ScaffoldNeedKind,
} from "./types.js";
