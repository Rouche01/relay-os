import type { Locator, Page } from "playwright";
import type { SemanticLocator } from "./types";

/** Default cap for decide / escalate state — keep prompts small. */
export const DEFAULT_PAGE_TEXT_MAX = 4000;

/** Max interactive candidates returned from one observe pass. */
export const DEFAULT_OBSERVE_CANDIDATE_MAX = 40;

/**
 * Locator owned by Relay code. Decide backends only see candidate id/label/hint;
 * actuation resolves id → this ref via `locatorById`.
 */
export type ObserveLocatorRef =
  | { kind: "role"; role: string; name?: string }
  | { kind: "text"; text: string }
  | { kind: "placeholder"; placeholder: string }
  | { kind: "css"; css: string };

export interface ObserveCandidate {
  /** Opaque id for DecisionCandidate / choose-among UI targets. */
  id: string;
  label: string;
  hint?: string;
  role?: string;
  locator: ObserveLocatorRef;
}

export interface ObservePageOptions {
  /** Max chars for compact page text. */
  maxTextChars?: number;
  /** Max interactive candidates. */
  maxCandidates?: number;
}

export interface ObservePageResult {
  url: string;
  title: string;
  /** Whitespace-collapsed, truncated body text. */
  text: string;
  candidates: ObserveCandidate[];
  /** Actuation map — never send to Jev; resolve id → locator in code. */
  locatorById: Record<string, ObserveLocatorRef>;
}

/** Raw node shape collected in the page (serializable). */
export interface InteractiveNodeSnapshot {
  tag: string;
  role: string;
  name: string;
  placeholder: string;
  type: string;
  href: string;
  testId: string;
  visible: boolean;
}

/**
 * Collapse whitespace and cap length for decide / escalate state.
 */
export function compactPageText(
  raw: string,
  maxChars = DEFAULT_PAGE_TEXT_MAX
): string {
  const flat = raw.replace(/\s+/g, " ").trim();
  if (flat.length <= maxChars) return flat;
  return `${flat.slice(0, Math.max(0, maxChars - 1))}…`;
}

/**
 * Build observe candidates + id→locator map from interactive node snapshots.
 * Pure — unit-tested without Playwright.
 */
export function buildObserveCandidates(
  nodes: InteractiveNodeSnapshot[],
  maxCandidates = DEFAULT_OBSERVE_CANDIDATE_MAX
): {
  candidates: ObserveCandidate[];
  locatorById: Record<string, ObserveLocatorRef>;
} {
  const candidates: ObserveCandidate[] = [];
  const locatorById: Record<string, ObserveLocatorRef> = {};
  const seen = new Set<string>();

  for (const node of nodes) {
    if (candidates.length >= maxCandidates) break;
    if (!node.visible) continue;

    const built = candidateFromNode(node, candidates.length);
    if (!built) continue;
    if (seen.has(built.id)) continue;
    seen.add(built.id);

    candidates.push(built);
    locatorById[built.id] = built.locator;
  }

  return { candidates, locatorById };
}

/**
 * Snapshot interactive controls + compact text from a live page.
 * Decide should only receive candidates' id/label/hint (+ text), not locators.
 */
export async function observePage(
  page: Page,
  options: ObservePageOptions = {}
): Promise<ObservePageResult> {
  const maxTextChars = options.maxTextChars ?? DEFAULT_PAGE_TEXT_MAX;
  const maxCandidates = options.maxCandidates ?? DEFAULT_OBSERVE_CANDIDATE_MAX;

  const snap = await page.evaluate(() => {
    const title = document.title ?? "";
    const url = location.href;
    const text = document.body?.innerText ?? "";

    const selector = [
      "a[href]",
      "button",
      "input",
      "textarea",
      "select",
      '[role="button"]',
      '[role="link"]',
      '[role="textbox"]',
      '[role="checkbox"]',
      '[role="menuitem"]',
      "[contenteditable='true']",
    ].join(",");

    const els = Array.from(document.querySelectorAll(selector));
    const nodes: InteractiveNodeSnapshot[] = [];

    for (const el of els) {
      if (!(el instanceof HTMLElement)) continue;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 && rect.height < 2) continue;

      const tag = el.tagName.toLowerCase();
      const role =
        el.getAttribute("role") ||
        (tag === "a"
          ? "link"
          : tag === "button"
            ? "button"
            : tag === "input" || tag === "textarea"
              ? "textbox"
              : tag === "select"
                ? "combobox"
                : "generic");

      const name = (
        el.getAttribute("aria-label") ||
        el.getAttribute("name") ||
        (el instanceof HTMLInputElement ? el.value : "") ||
        el.innerText ||
        el.textContent ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);

      const placeholder =
        el.getAttribute("placeholder") ||
        (el instanceof HTMLInputElement ? el.placeholder : "") ||
        "";

      const type =
        el instanceof HTMLInputElement ? el.type || "text" : tag;
      const href = el instanceof HTMLAnchorElement ? el.href || "" : "";
      const testId = el.getAttribute("data-testid") || "";

      nodes.push({
        tag,
        role,
        name,
        placeholder: placeholder.slice(0, 80),
        type,
        href: href.slice(0, 200),
        testId: testId.slice(0, 80),
        visible: true,
      });
    }

    return { title, url, text, nodes };
  });

  const { candidates, locatorById } = buildObserveCandidates(
    snap.nodes,
    maxCandidates
  );

  return {
    url: snap.url,
    title: snap.title,
    text: compactPageText(snap.text, maxTextChars),
    candidates,
    locatorById,
  };
}

/** Convert an observe locator ref into the engine's SemanticLocator (or css). */
export function observeRefToSemantic(
  ref: ObserveLocatorRef
): SemanticLocator | { css: string } {
  switch (ref.kind) {
    case "role":
      return { role: ref.role, name: ref.name };
    case "text":
      return { text: ref.text };
    case "placeholder":
      return { placeholder: ref.placeholder };
    case "css":
      return { css: ref.css };
  }
}

/**
 * Resolve an observe locator ref on a live page (id→locator owned by Relay).
 * Apps use this after DecisionPort picks a candidate id.
 */
export function resolveObserveLocator(
  page: Page,
  ref: ObserveLocatorRef
): Locator {
  const target = observeRefToSemantic(ref);
  if ("css" in target && target.css) {
    return page.locator(target.css);
  }
  if ("role" in target && target.role) {
    return page.getByRole(target.role as Parameters<Page["getByRole"]>[0], {
      name: target.name,
    });
  }
  if ("text" in target && target.text) {
    return page.getByText(target.text);
  }
  if ("placeholder" in target && target.placeholder) {
    return page.getByPlaceholder(target.placeholder);
  }
  throw new Error("Invalid observe locator ref");
}

function candidateFromNode(
  node: InteractiveNodeSnapshot,
  index: number
): ObserveCandidate | null {
  const label =
    node.name ||
    node.placeholder ||
    node.testId ||
    `${node.role || node.tag}#${index}`;
  if (!label.trim()) return null;

  const role = node.role || node.tag;
  let locator: ObserveLocatorRef;
  let id: string;

  if (node.testId) {
    id = `testid:${slug(node.testId)}`;
    locator = { kind: "css", css: `[data-testid="${cssEscape(node.testId)}"]` };
  } else if (node.placeholder) {
    id = `ph:${slug(node.placeholder)}`;
    locator = { kind: "placeholder", placeholder: node.placeholder };
  } else if (node.name && (role === "button" || role === "link" || role === "textbox")) {
    id = `role:${role}:${slug(node.name)}`;
    locator = { kind: "role", role, name: node.name };
  } else if (node.name) {
    id = `text:${slug(node.name)}`;
    locator = { kind: "text", text: node.name };
  } else if (node.tag === "a" && node.href) {
    id = `a:${index}`;
    locator = { kind: "css", css: `a[href="${cssEscape(node.href)}"]` };
  } else {
    id = `${role}:${index}`;
    locator = {
      kind: "css",
      css: `${node.tag}${node.type && node.tag === "input" ? `[type="${cssEscape(node.type)}"]` : ""}`,
    };
  }

  const hintParts = [role];
  if (node.type && node.tag === "input") hintParts.push(`type=${node.type}`);
  if (node.href) hintParts.push("link");

  return {
    id,
    label: label.slice(0, 80),
    hint: hintParts.join(" · "),
    role,
    locator,
  };
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function cssEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
