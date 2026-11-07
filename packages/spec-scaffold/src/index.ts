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
export {
  proposeSlotsFromIntent,
  needsFromCapabilitySlots,
  withSlotsFromIntent,
} from "./slots.js";
export { SCAFFOLD_SPEC_JSON_SCHEMA } from "./schema.js";
export { scaffoldSpec, specBodyToYaml } from "./scaffold.js";
/** Re-export fixture generator for Desk / hosts that skip scaffoldSpec. */
export {
  generateEvalFixtures,
  hasEvaluableFixtures,
} from "@relay/spec-evals";
export type {
  ScaffoldAttempt,
  ScaffoldResult,
  ScaffoldSpecOptions,
  ScaffoldNeed,
  ScaffoldNeedAction,
  ScaffoldNeedKind,
} from "./types.js";
