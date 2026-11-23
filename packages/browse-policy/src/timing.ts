import {
  defaultSeatTiming,
  sampleWaitMs,
  shouldExit,
} from "@useapron/seat";
import type { BrowseTimingConfig } from "./types.js";

/** @deprecated Prefer importing sampleWaitMs / shouldExit from @useapron/seat. */
export { sampleWaitMs, shouldExit };

export function defaultBrowseTiming(
  overrides: Partial<BrowseTimingConfig> = {}
): BrowseTimingConfig {
  return defaultSeatTiming(overrides);
}
