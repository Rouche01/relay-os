import {
  defaultSeatTiming,
  sampleWaitMs,
  shouldExit,
} from "@useapron/seat";
import type { PhoneTimingConfig } from "./types.js";

export { sampleWaitMs, shouldExit };

export function defaultPhoneTiming(
  overrides: Partial<PhoneTimingConfig> = {}
): PhoneTimingConfig {
  return defaultSeatTiming(overrides);
}
