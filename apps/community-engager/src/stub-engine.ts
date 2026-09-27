import type { EngineType, ExecutionEngine } from "@relay/protocol";

/** Minimal engine stand-in — CommunityEngager logic lives in the AppController. */
export function createStubEngine(type: Exclude<EngineType, "none">): ExecutionEngine {
  return {
    type,
    async execute() {
      return { success: true };
    },
    async healthCheck() {
      return true;
    },
    async teardown() {},
  };
}
