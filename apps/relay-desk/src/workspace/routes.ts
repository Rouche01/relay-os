import { isWorkspaceView, type WorkspaceView } from "./journey.ts";

export type MainTab = "seats" | "build" | "apps";

export type DeskRoute =
  | { kind: "seats" }
  | { kind: "build" }
  | { kind: "build-new" }
  | { kind: "build-workspace"; draftId: string; view: WorkspaceView }
  | { kind: "apps" }
  | { kind: "apps-detail"; appId: string };

/** Parse `location.hash` (`#/seats`, `#/build/:id/design`, …). Unknown → seats. */
export function parseHash(hash: string): DeskRoute {
  const raw = hash.replace(/^#/, "").replace(/^\//, "").trim();
  if (!raw) return { kind: "seats" };

  const parts = raw.split("/").filter(Boolean);
  const [a, b, c] = parts;

  if (a === "seats") return { kind: "seats" };

  if (a === "build") {
    if (!b) return { kind: "build" };
    if (b === "new") return { kind: "build-new" };
    const view = c && isWorkspaceView(c) ? c : "design";
    return { kind: "build-workspace", draftId: decodeURIComponent(b), view };
  }

  if (a === "apps") {
    if (!b) return { kind: "apps" };
    return { kind: "apps-detail", appId: decodeURIComponent(b) };
  }

  return { kind: "seats" };
}

export function serializeRoute(route: DeskRoute): string {
  switch (route.kind) {
    case "seats":
      return "#/seats";
    case "build":
      return "#/build";
    case "build-new":
      return "#/build/new";
    case "build-workspace":
      return `#/build/${encodeURIComponent(route.draftId)}/${route.view}`;
    case "apps":
      return "#/apps";
    case "apps-detail":
      return `#/apps/${encodeURIComponent(route.appId)}`;
  }
}

export function mainTabFromRoute(route: DeskRoute): MainTab {
  switch (route.kind) {
    case "seats":
      return "seats";
    case "build":
    case "build-new":
    case "build-workspace":
      return "build";
    case "apps":
    case "apps-detail":
      return "apps";
  }
}

export function railRoute(tab: MainTab): DeskRoute {
  switch (tab) {
    case "seats":
      return { kind: "seats" };
    case "build":
      return { kind: "build" };
    case "apps":
      return { kind: "apps" };
  }
}
