import {
  defaultSeatTiming,
  sampleWaitMs,
  shouldExit,
} from "@relay/computer-seat-policy";
import type { BrowseTimingConfig } from "./types.js";

/** @deprecated Prefer importing sampleWaitMs / shouldExit from @relay/computer-seat-policy directly. */
export { sampleWaitMs, shouldExit };

export function defaultBrowseTiming(
  overrides: Partial<BrowseTimingConfig> = {}
): BrowseTimingConfig {
  return defaultSeatTiming(overrides);
}
