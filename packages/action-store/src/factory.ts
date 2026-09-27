import { FileJsonActionStore } from "./file-json-store.js";
import type { ActionStore } from "./types.js";

/**
 * Driver config. Apps pick a driver via env/factory — never import drivers directly
 * if you want a clean swap to Postgres later.
 */
export type ActionStoreConfig =
  | {
      driver: "file";
      /** JSON file path (default `.data/actions.json`) */
      filePath?: string;
    }
  | {
      /** Reserved — implement PostgresActionStore against the same ActionStore port. */
      driver: "postgres";
      connectionString: string;
      table?: string;
    };

/**
 * Construct an ActionStore from config.
 * `postgres` is intentionally unimplemented until a deploy needs it.
 */
export function createActionStore(config: ActionStoreConfig = { driver: "file" }): ActionStore {
  switch (config.driver) {
    case "file":
      return new FileJsonActionStore({ filePath: config.filePath });
    case "postgres":
      throw new Error(
        "PostgresActionStore is not implemented yet. Use driver: \"file\" for v1, " +
          "or implement ActionStore against your Postgres client and pass it directly."
      );
    default: {
      const _exhaustive: never = config;
      throw new Error(`Unknown action store driver: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/** Read ACTION_STORE / ACTION_STORE_PATH from env (defaults to file). */
export function createActionStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env
): ActionStore {
  const driver = (env.ACTION_STORE ?? "file").toLowerCase();
  if (driver === "postgres") {
    const connectionString = env.ACTION_STORE_DATABASE_URL ?? env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "ACTION_STORE=postgres requires ACTION_STORE_DATABASE_URL or DATABASE_URL"
      );
    }
    return createActionStore({
      driver: "postgres",
      connectionString,
      table: env.ACTION_STORE_TABLE,
    });
  }
  return createActionStore({
    driver: "file",
    filePath: env.ACTION_STORE_PATH,
  });
}
