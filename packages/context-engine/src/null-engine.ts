import type { MemoryHit } from "@voltmem/client";
import type {
  AddFactOptions,
  ContextEngine,
  SearchMemoryOptions,
} from "./types.js";

/**
 * No-op engine when VoltMem is not configured.
 * Always fail-open / available=false.
 */
export class NullContextEngine implements ContextEngine {
  readonly name = "null";
  readonly available = false;

  async health(): Promise<boolean> {
    return false;
  }

  async addFact(_text: string, _options?: AddFactOptions): Promise<boolean> {
    return false;
  }

  async search(_query: string, _options?: SearchMemoryOptions): Promise<MemoryHit[]> {
    return [];
  }

  async rememberForPrompt(
    _query: string,
    _options?: SearchMemoryOptions
  ): Promise<string> {
    return "";
  }
}
