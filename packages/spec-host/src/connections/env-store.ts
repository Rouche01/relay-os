import { SpecHostError } from "../errors.js";
import { FileJsonConnectionStore } from "./file-store.js";
import type { ConnectionFileDocument, ConnectionStore } from "./types.js";
import type { ConnectionCredentials } from "@relay/engines-api";
import { resolveSecretRef } from "./resolve-secret.js";

/**
 * Env-backed store.
 *
 * 1. If `RELAY_CONNECTIONS_FILE` is set → load that JSON file (FileJsonConnectionStore).
 * 2. Else if `RELAY_CONNECTIONS` is set → parse as JSON document (same shape as file).
 * 3. Else use optional `map` of id → { type, tokenEnv / valueEnv / … } for explicit wiring.
 *
 * Specs still only see refs like `github:default`.
 */
export type EnvConnectionMapEntry =
  | { type: "none" }
  | { type: "bearer"; tokenEnv: string }
  | { type: "apiKey"; header: string; valueEnv: string };

export type EnvConnectionStoreOptions = {
  env?: NodeJS.ProcessEnv;
  /** Explicit id → env var mapping when RELAY_CONNECTIONS* unset. */
  map?: Readonly<Record<string, EnvConnectionMapEntry>>;
  /** Override file path env key (default RELAY_CONNECTIONS_FILE). */
  fileEnvKey?: string;
  /** Override JSON blob env key (default RELAY_CONNECTIONS). */
  jsonEnvKey?: string;
};

export class EnvConnectionStore implements ConnectionStore {
  private readonly inner: ConnectionStore;

  constructor(options: EnvConnectionStoreOptions = {}) {
    const env = options.env ?? process.env;
    const fileKey = options.fileEnvKey ?? "RELAY_CONNECTIONS_FILE";
    const jsonKey = options.jsonEnvKey ?? "RELAY_CONNECTIONS";
    const filePath = env[fileKey]?.trim();
    if (filePath) {
      this.inner = FileJsonConnectionStore.fromFile(filePath, { env });
      return;
    }
    const blob = env[jsonKey]?.trim();
    if (blob) {
      let doc: ConnectionFileDocument;
      try {
        doc = JSON.parse(blob) as ConnectionFileDocument;
      } catch (err) {
        throw new SpecHostError(
          "connection_env_invalid",
          `Env ${jsonKey} is not valid JSON: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
      this.inner = new FileJsonConnectionStore(doc, { env });
      return;
    }
    this.inner = new MapConnectionStore(options.map ?? {}, env);
  }

  listIds(): readonly string[] | Promise<readonly string[]> {
    return this.inner.listIds();
  }

  get(
    id: string
  ):
    | ConnectionCredentials
    | undefined
    | Promise<ConnectionCredentials | undefined> {
    return this.inner.get(id);
  }
}

class MapConnectionStore implements ConnectionStore {
  constructor(
    private readonly map: Readonly<Record<string, EnvConnectionMapEntry>>,
    private readonly env: NodeJS.ProcessEnv
  ) {}

  listIds(): readonly string[] {
    return Object.keys(this.map).sort();
  }

  get(id: string): ConnectionCredentials | undefined {
    const entry = this.map[id];
    if (!entry) return undefined;
    try {
      if (entry.type === "none") return { type: "none" };
      if (entry.type === "bearer") {
        return {
          type: "bearer",
          token: resolveSecretRef(
            `env:${entry.tokenEnv}`,
            this.env,
            `${id}.token`
          ),
        };
      }
      return {
        type: "apiKey",
        header: entry.header,
        value: resolveSecretRef(
          `env:${entry.valueEnv}`,
          this.env,
          `${id}.value`
        ),
      };
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
}

export function createEnvConnectionStore(
  options?: EnvConnectionStoreOptions
): EnvConnectionStore {
  return new EnvConnectionStore(options);
}
