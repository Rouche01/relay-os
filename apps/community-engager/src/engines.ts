import type { ContextEngine } from "@relay/context-engine";
import { PlaywrightEngine } from "@relay/engines-browser";
import type {
  EngineAction,
  EngineResult,
  ExecutionEngine,
} from "@relay/protocol";
import { bindEngines, type EngineProviders } from "@relay/runtime";
import { draftReply, type DraftReplyOptions } from "./drafter.js";
import { CommunityEngagerManifest } from "./manifest.js";
import {
  browserUserAgent,
} from "./reddit/browser-session.js";
import { getRedditEnv, type RedditEnvConfig } from "./reddit/config.js";
import type { CommunityDraft } from "./types.js";

export interface CommunityEnginesOptions {
  memory: ContextEngine;
  cfg?: RedditEnvConfig;
}

/**
 * Manifest-bound engines for CommunityEngager.
 * Browser sessions for scout/login/comment still use per-op
 * `createRedditBrowserEngine` (short-lived); the bound browser engine is the
 * declared capability + default Playwright config for the app.
 */
export function createCommunityEngines(
  options: CommunityEnginesOptions
): Record<string, ExecutionEngine> {
  const cfg = options.cfg ?? getRedditEnv();
  const providers: EngineProviders = {
    browser: () =>
      new PlaywrightEngine({
        headless: cfg.browserHeadless,
        userAgent: browserUserAgent(cfg),
      }),
    llm: () => createLlmDraftEngine(),
    data: () => createDataEngine(options.memory),
  };

  if (cfg.oauthConfigured) {
    providers.api = () => createRedditApiCapabilityEngine(cfg);
  }

  return bindEngines(CommunityEngagerManifest, providers);
}

/** Draft-stage LLM engine — stub drafter until a real LLM provider is wired. */
export function createLlmDraftEngine(): ExecutionEngine {
  return {
    type: "llm",
    async execute(action: EngineAction): Promise<EngineResult> {
      if (action.type !== "draft_reply") {
        return {
          success: false,
          error: `Unsupported llm action: ${action.type}`,
        };
      }
      const draft = action.params.draft as CommunityDraft | undefined;
      if (!draft) {
        return { success: false, error: "draft_reply requires params.draft" };
      }
      const overrides = action.params.overrides as DraftReplyOptions | undefined;
      const result = await draftReply(draft, overrides);
      return { success: true, data: { draft: result } };
    },
    async healthCheck() {
      return true;
    },
    async teardown() {},
  };
}

/** Learn-stage data engine — VoltMem / ContextEngine. */
export function createDataEngine(memory: ContextEngine): ExecutionEngine {
  return {
    type: "data",
    async execute(action: EngineAction): Promise<EngineResult> {
      if (action.type === "add_fact") {
        const text = String(action.params.text ?? "");
        const ok = await memory.addFact(text, {
          domain: action.params.domain as string | undefined,
          source: action.params.source as string | undefined,
        });
        return { success: ok, data: { written: ok } };
      }
      if (action.type === "remember_for_prompt") {
        const query = String(action.params.query ?? "");
        const block = await memory.rememberForPrompt(query, {
          limit: Number(action.params.limit ?? 5),
        });
        return { success: true, data: { block } };
      }
      return {
        success: false,
        error: `Unsupported data action: ${action.type}`,
      };
    },
    async healthCheck() {
      return memory.health();
    },
    async teardown() {},
  };
}

/**
 * Optional API capability when OAuth is configured.
 * Scout/execute still prefer browser; this documents oauth availability.
 */
export function createRedditApiCapabilityEngine(
  cfg: RedditEnvConfig
): ExecutionEngine {
  return {
    type: "api",
    async execute(action: EngineAction): Promise<EngineResult> {
      return {
        success: false,
        error: `api action "${action.type}" not implemented on capability engine (use RedditClient / scout-live)`,
      };
    },
    async healthCheck() {
      return cfg.oauthConfigured;
    },
    async teardown() {},
  };
}
