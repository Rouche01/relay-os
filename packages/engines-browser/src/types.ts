import { EngineAction } from "@relay/protocol";

export type SemanticLocator =
  | { role: string; name?: string }
  | { text: string }
  | { placeholder: string }
  /** Escape hatch for observe-built CSS (data-testid, etc.). */
  | { css: string };

export interface BrowserActionParams {
  url?: string;
  target?: SemanticLocator;
  value?: string; // For input actions
}

export interface BrowserEngineAction extends EngineAction {
  type: "navigate" | "click" | "input" | "extract" | "snapshot";
  params: BrowserActionParams;
}
