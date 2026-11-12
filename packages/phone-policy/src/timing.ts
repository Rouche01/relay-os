import {
  defaultSeatTiming,
  sampleWaitMs,
  shouldExit,
} from "@relay/computer-seat-policy";
import type { PhoneTimingConfig } from "./types.js";

export { sampleWaitMs, shouldExit };

export function defaultPhoneTiming(
  overrides: Partial<PhoneTimingConfig> = {}
): PhoneTimingConfig {
  return defaultSeatTiming(overrides);
}
