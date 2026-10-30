import type {
  ConnectionCredentials,
  ConnectionResolver,
} from "@relay/engines-api";

/**
 * Pluggable secrets backend for Spec connection refs (`github:default`).
 * Specs never hold tokens — only refs. Stores hold credentials.
 */
export interface ConnectionStore {
  /** Connection ids known to this store (for validator knownConnections). */
  listIds(): readonly string[] | Promise<readonly string[]>;
  /** Resolve one ref. Undefined = unknown / not configured. */
  get(
    id: string
  ):
    | ConnectionCredentials
    | undefined
    | Promise<ConnectionCredentials | undefined>;
}

export type { ConnectionCredentials, ConnectionResolver };

/** Serialized file / env JSON shape (no secrets required to be inline). */
export type ConnectionFileEntry =
  | { type: "none" }
  | {
      type: "bearer";
      /** Literal token, or `env:VAR_NAME` to read from process env. */
      token: string;
    }
  | {
      type: "apiKey";
      header: string;
      /** Literal value, or `env:VAR_NAME`. */
      value: string;
    };

export type ConnectionFileDocument = Record<string, ConnectionFileEntry>;
