import { execFileSync } from "node:child_process";
import type { ConnectionCredentials } from "@relay/engines-api";
import { SpecHostError } from "../errors.js";
import type { ConnectionStore } from "./types.js";

export type KeychainConnectionStoreOptions = {
  /** Keychain service name (default `relay-os`). */
  service?: string;
  /**
   * Known connection ids. Keychain cannot list Relay accounts portably —
   * callers must declare which refs exist (or pass listIds explicitly).
   */
  ids: readonly string[];
  /**
   * Account name for a connection id (default: the id itself, e.g. `github:default`).
   */
  accountForId?: (id: string) => string;
  /** Inject for tests — returns password string or throws. */
  readPassword?: (service: string, account: string) => string;
  /**
   * How to interpret the stored password:
   * - `bearer` (default) → `{ type: "bearer", token }`
   * - `json` → full ConnectionCredentials JSON
   */
  format?: "bearer" | "json";
};

function defaultReadPassword(service: string, account: string): string {
  try {
    return execFileSync(
      "security",
      ["find-generic-password", "-s", service, "-a", account, "-w"],
      { encoding: "utf8" }
    ).trim();
  } catch (err) {
    throw new SpecHostError(
      "connection_keychain_miss",
      `macOS keychain has no password for service=${JSON.stringify(
        service
      )} account=${JSON.stringify(account)}`,
      {
        service,
        account,
        cause: err instanceof Error ? err.message : String(err),
      }
    );
  }
}

/**
 * macOS Keychain-backed store (optional). Uses `/usr/bin/security`.
 * Store secrets with:
 * `security add-generic-password -s relay-os -a 'github:default' -w '<token>'`
 */
export class KeychainConnectionStore implements ConnectionStore {
  private readonly service: string;
  private readonly ids: readonly string[];
  private readonly accountForId: (id: string) => string;
  private readonly readPassword: (service: string, account: string) => string;
  private readonly format: "bearer" | "json";

  constructor(options: KeychainConnectionStoreOptions) {
    this.service = options.service ?? "relay-os";
    this.ids = [...options.ids];
    this.accountForId = options.accountForId ?? ((id) => id);
    this.readPassword = options.readPassword ?? defaultReadPassword;
    this.format = options.format ?? "bearer";
  }

  listIds(): readonly string[] {
    return [...this.ids].sort();
  }

  get(id: string): ConnectionCredentials | undefined {
    if (!this.ids.includes(id)) return undefined;
    const account = this.accountForId(id);
    const secret = this.readPassword(this.service, account);
    if (this.format === "json") {
      try {
        return JSON.parse(secret) as ConnectionCredentials;
      } catch (err) {
        throw new SpecHostError(
          "connection_keychain_invalid",
          `Keychain secret for ${JSON.stringify(id)} is not valid JSON credentials`,
          { connectionId: id, cause: err instanceof Error ? err.message : String(err) }
        );
      }
    }
    return { type: "bearer", token: secret };
  }
}

export function createKeychainConnectionStore(
  options: KeychainConnectionStoreOptions
): KeychainConnectionStore {
  return new KeychainConnectionStore(options);
}
