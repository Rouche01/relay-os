#!/usr/bin/env node
/**
 * CommunityEngager operator console — Actions + Allowlist + Jobs + Runs + Authority
 * on @relay/admin-shell with independent SourceConfig paths.
 */
import path from "node:path";
import { createRequire } from "node:module";
import { createAdminServer, loadAdminEnv } from "@relay/admin-shell";
import {
  createActionStoreCollection,
  createActionStoreFromEnv,
} from "@relay/action-store";
import { createAllowlistCollection } from "./admin/allowlist-collection.js";
import { createAuthorityCollection } from "./admin/authority-collection.js";
import { createJobsCollection } from "./admin/jobs-collection.js";
import { createRunsCollection } from "./admin/runs-collection.js";
import {
  actionsSource,
  allowlistSource,
  assertFileSource,
  authoritySource,
  jobsSource,
  runsSource,
} from "./admin/sources.js";

const requireFromHere = createRequire(__filename);

function adminShellPublicDir(): string {
  const pkg = path.dirname(
    requireFromHere.resolve("@relay/admin-shell/package.json")
  );
  return path.join(pkg, "public");
}

async function main(): Promise<void> {
  const envFile = loadAdminEnv(process.env, {
    candidates: [path.resolve(process.cwd(), ".env")],
  });
  if (envFile) console.log(`Env: ${envFile}`);

  const actions = actionsSource();
  const allowlist = allowlistSource();
  const jobs = jobsSource();
  const runs = runsSource();
  const authority = authoritySource();
  assertFileSource(actions, "actions");
  assertFileSource(allowlist, "allowlist");
  assertFileSource(jobs, "jobs");
  assertFileSource(runs, "runs");
  assertFileSource(authority, "authority");

  const store = createActionStoreFromEnv();
  const port = Number(
    process.env.ADMIN_PORT ?? process.env.ACTION_STORE_ADMIN_PORT ?? "8787"
  );

  await createAdminServer({
    title: "Community engager",
    port,
    publicDir: adminShellPublicDir(),
    collections: [
      createActionStoreCollection(store, actions),
      createAllowlistCollection(allowlist),
      createJobsCollection(jobs),
      createRunsCollection(runs),
      createAuthorityCollection(authority),
    ],
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
