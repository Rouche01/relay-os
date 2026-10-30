import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  parseServiceDescriptorYaml,
  type ServiceDescriptor,
} from "@relay/protocol";
import {
  CURATED_SERVICE_IDS,
  type CuratedServiceId,
} from "./catalog.js";

function packageRoot(): string {
  // dist/ → package root; src/ via ts-node / tests from dist-test
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "descriptors")) && existsSync(join(dir, "package.json"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("@relay/services: cannot locate descriptors/ directory");
}

export function descriptorsDir(): string {
  return join(packageRoot(), "descriptors");
}

/** Load one curated descriptor by id (e.g. "github"). */
export function loadCuratedService(id: string): ServiceDescriptor {
  const path = join(descriptorsDir(), `${id}.yaml`);
  if (!existsSync(path)) {
    throw new Error(`Unknown curated service ${JSON.stringify(id)} (${path})`);
  }
  return parseServiceDescriptorYaml(readFileSync(path, "utf8"));
}

/**
 * Load the curated catalog.
 * @param ids subset (default: all CURATED_SERVICE_IDS)
 */
export function loadCuratedServices(
  ids: readonly string[] = CURATED_SERVICE_IDS
): ServiceDescriptor[] {
  return ids.map((id) => loadCuratedService(id));
}

/** All `*.yaml` files under descriptors/ (includes any extras beyond the catalog list). */
export function loadAllDescriptorFiles(): ServiceDescriptor[] {
  const dir = descriptorsDir();
  const names = readdirSync(dir)
    .filter((n) => n.endsWith(".yaml") || n.endsWith(".yml"))
    .sort();
  return names.map((n) =>
    parseServiceDescriptorYaml(readFileSync(join(dir, n), "utf8"))
  );
}

export function listCuratedServiceIds(): CuratedServiceId[] {
  return [...CURATED_SERVICE_IDS];
}
