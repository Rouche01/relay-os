import type { MemoryHit, MemoryItem, WriteResult } from "@voltmem/client";
import type {
  AddEventOptions,
  AddFactOptions,
  ContextEngine,
  GetEventOptions,
  MemoryEventFacet,
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

  async addEvent(
    _eventId: string,
    _facets: MemoryEventFacet[],
    _options?: AddEventOptions
  ): Promise<WriteResult[]> {
    return [];
  }

  async getEvent(
    _eventId: string,
    _options?: GetEventOptions
  ): Promise<MemoryItem[]> {
    return [];
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
