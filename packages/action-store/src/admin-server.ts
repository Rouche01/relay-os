#!/usr/bin/env node
import path from "node:path";
import { createRequire } from "node:module";
import {
  createAdminServer,
  loadAdminEnv,
} from "@relay/admin-shell";
import {
  actionStoreSourceFromEnv,
  createActionStoreCollection,
} from "./action-collection.js";
import { createActionStoreFromEnv } from "./factory.js";

const requireFromHere = createRequire(__filename);

function adminShellPublicDir(): string {
  const pkg = path.dirname(
    requireFromHere.resolve("@relay/admin-shell/package.json")
  );
  return path.join(pkg, "public");
}

async function main(): Promise<void> {
  const envFile = loadAdminEnv(process.env, {
    candidates: [
      path.resolve(process.cwd(), ".env"),
      path.resolve(
        path.dirname(path.resolve(process.argv[1] ?? ".")),
        "../../../apps/community-engager/.env"
      ),
    ],
  });
  if (envFile) {
    console.log(`Env: ${envFile}`);
  }

  const store = createActionStoreFromEnv();
  const source = actionStoreSourceFromEnv();
  // createAdminServer rejects postgres sources until drivers exist
  if (source.driver === "postgres") {
    throw new Error(
      "ACTION_STORE=postgres is not implemented for the admin yet; use file driver"
    );
  }

  const port = Number(
    process.env.ADMIN_PORT ?? process.env.ACTION_STORE_ADMIN_PORT ?? "8787"
  );

  await createAdminServer({
    title: "Relay actions",
    port,
    publicDir: adminShellPublicDir(),
    collections: [createActionStoreCollection(store, source)],
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
