import type { EngineAction, EngineResult, ExecutionEngine } from "@relay/protocol";

/**
 * Offline / CI browser engine implementing Spec catalog verbs:
 * navigate | read | click | type | submit
 *
 * Irreversible `submit` simulates when dryRun (same evidence shape as engines-api).
 * Callers that need a real browser pass Playwright via `extraEngines.browser`.
 */
export type FixtureBrowserLogEntry = {
  type: string;
  params: Record<string, unknown>;
};

export type FixtureBrowserEngineOptions = {
  dryRun?: boolean;
  /** Seed page text for read. */
  pageText?: string;
  /** Mutable log of executed verbs (tests). */
  log?: FixtureBrowserLogEntry[];
};

export function createFixtureBrowserEngine(
  options: FixtureBrowserEngineOptions = {}
): ExecutionEngine {
  const dryRun = options.dryRun !== false;
  const log = options.log ?? [];
  let url = "";
  let pageText = options.pageText ?? "fixture page text";

  return {
    type: "browser",
    async healthCheck() {
      return true;
    },
    async teardown() {},
    async execute(action: EngineAction): Promise<EngineResult> {
      const params = (action.params ?? {}) as Record<string, unknown>;
      log.push({ type: action.type, params });
      switch (action.type) {
        case "navigate": {
          if (typeof params.url !== "string" || !params.url.trim()) {
            return { success: false, error: "browser.navigate requires url" };
          }
          url = params.url.trim();
          return { success: true, data: { url } };
        }
        case "read": {
          return {
            success: true,
            data: {
              text: pageText,
              url,
              selector: params.selector ?? null,
              as: params.as ?? "text",
            },
          };
        }
        case "click": {
          if (typeof params.selector !== "string" || !params.selector.trim()) {
            return { success: false, error: "browser.click requires selector" };
          }
          return {
            success: true,
            data: { clicked: params.selector },
          };
        }
        case "type": {
          if (typeof params.selector !== "string" || !params.selector.trim()) {
            return { success: false, error: "browser.type requires selector" };
          }
          if (typeof params.text !== "string") {
            return { success: false, error: "browser.type requires text" };
          }
          pageText = params.text;
          return {
            success: true,
            data: { selector: params.selector, text: params.text },
          };
        }
        case "submit": {
          if (dryRun) {
            return {
              success: true,
              data: {
                dryRunSimulated: true,
                submitted: true,
                selector: params.selector ?? null,
              },
            };
          }
          return {
            success: true,
            data: { submitted: true, selector: params.selector ?? null },
          };
        }
        default:
          return {
            success: false,
            error: `Unsupported browser verb ${JSON.stringify(action.type)} (fixture engine)`,
          };
      }
    },
  };
}

/**
 * Offline / CI computer engine implementing Spec catalog verbs: observe | act
 *
 * Irreversible `act` simulates when dryRun.
 * Live gateway: pass ComputerEngine via `extraEngines.computer`.
 */
export type FixtureComputerLogEntry = {
  type: string;
  params: Record<string, unknown>;
};

export type FixtureComputerEngineOptions = {
  dryRun?: boolean;
  log?: FixtureComputerLogEntry[];
};

export function createFixtureComputerEngine(
  options: FixtureComputerEngineOptions = {}
): ExecutionEngine {
  const dryRun = options.dryRun !== false;
  const log = options.log ?? [];
  let lastObserve = { image: "fixture-screenshot", query: null as string | null };

  return {
    type: "computer",
    async healthCheck() {
      return true;
    },
    async teardown() {},
    async execute(action: EngineAction): Promise<EngineResult> {
      const params = (action.params ?? {}) as Record<string, unknown>;
      log.push({ type: action.type, params });
      switch (action.type) {
        case "observe": {
          lastObserve = {
            image: "fixture-screenshot",
            query: typeof params.query === "string" ? params.query : null,
          };
          return { success: true, data: lastObserve };
        }
        case "act": {
          if (typeof params.action !== "string" || !params.action.trim()) {
            return { success: false, error: "computer.act requires action" };
          }
          if (dryRun) {
            return {
              success: true,
              data: {
                dryRunSimulated: true,
                action: params.action,
                params: params.params ?? {},
              },
            };
          }
          return {
            success: true,
            data: {
              action: params.action,
              params: params.params ?? {},
              ok: true,
            },
          };
        }
        default:
          return {
            success: false,
            error: `Unsupported computer verb ${JSON.stringify(action.type)} (fixture engine)`,
          };
      }
    },
  };
}
