import { readFileSync } from "node:fs";
import type { ConnectionCredentials } from "@relay/engines-api";
import { SpecHostError } from "../errors.js";
import { resolveSecretRef } from "./resolve-secret.js";
import type {
  ConnectionFileDocument,
  ConnectionFileEntry,
  ConnectionStore,
} from "./types.js";

function entryToCredentials(
  id: string,
  entry: ConnectionFileEntry,
  env: NodeJS.ProcessEnv
): ConnectionCredentials {
  try {
    if (entry.type === "none") return { type: "none" };
    if (entry.type === "bearer") {
      return {
        type: "bearer",
        token: resolveSecretRef(entry.token, env, `${id}.token`),
      };
    }
    if (entry.type === "apiKey") {
      return {
        type: "apiKey",
        header: entry.header,
        value: resolveSecretRef(entry.value, env, `${id}.value`),
      };
    }
    throw new Error(`unknown entry type`);
  } catch (err) {
    throw new SpecHostError(
      "connection_secret_unresolved",
      `Failed to resolve connection ${JSON.stringify(id)}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      { connectionId: id }
    );
  }
}

/**
 * JSON file connection store.
 *
 * ```json
 * {
 *   "github:default": { "type": "bearer", "token": "env:GITHUB_TOKEN" },
 *   "reddit:default": { "type": "bearer", "token": "env:REDDIT_TOKEN" }
 * }
 * ```
 *
 * Literals are allowed for local dogfood; prefer `env:` refs so the file is not a secret dump.
 */
export class FileJsonConnectionStore implements ConnectionStore {
  private readonly doc: ConnectionFileDocument;
  private readonly env: NodeJS.ProcessEnv;

  constructor(
    doc: ConnectionFileDocument,
    options?: { env?: NodeJS.ProcessEnv }
  ) {
    this.doc = doc;
    this.env = options?.env ?? process.env;
  }

  static fromFile(
    path: string,
    options?: { env?: NodeJS.ProcessEnv }
  ): FileJsonConnectionStore {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    } catch (err) {
      throw new SpecHostError(
        "connection_file_unreadable",
        `Cannot read connections file ${JSON.stringify(path)}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { path }
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new SpecHostError(
        "connection_file_invalid",
        `Connections file ${JSON.stringify(path)} must be a JSON object`,
        { path }
      );
    }
    return new FileJsonConnectionStore(
      parsed as ConnectionFileDocument,
      options
    );
  }

  listIds(): readonly string[] {
    return Object.keys(this.doc).sort();
  }

  get(id: string): ConnectionCredentials | undefined {
    const entry = this.doc[id];
    if (!entry) return undefined;
    return entryToCredentials(id, entry, this.env);
  }
}

export function createFileJsonConnectionStore(
  doc: ConnectionFileDocument,
  options?: { env?: NodeJS.ProcessEnv }
): FileJsonConnectionStore {
  return new FileJsonConnectionStore(doc, options);
}
