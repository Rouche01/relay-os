#!/usr/bin/env node
/**
 * CommunityEngager operator console — Actions + Allowlist + Jobs + Runs +
 * Authority + Schedules on @relay/admin-shell with independent SourceConfig paths.
 */
import path from "node:path";
import { createRequire } from "node:module";
import { createAdminServer, loadAdminEnv } from "@relay/admin-shell";
import {
  createActionStoreCollection,
  createActionStoreFromEnv,
} from "@relay/action-store";
import { createAllowlistCollection } from "../admin/allowlist-collection.js";
import { createAuthorityCollection } from "../admin/authority-collection.js";
import { createJobsCollection } from "../admin/jobs-collection.js";
import { createRunsCollection } from "../admin/runs-collection.js";
import { createSchedulesCollection } from "../admin/schedules-collection.js";
import {
  actionsSource,
  allowlistSource,
  assertFileSource,
  authoritySource,
  jobsSource,
  runsSource,
  schedulesSource,
} from "../admin/sources.js";

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
  const schedules = schedulesSource();
  assertFileSource(actions, "actions");
  assertFileSource(allowlist, "allowlist");
  assertFileSource(jobs, "jobs");
  assertFileSource(runs, "runs");
  assertFileSource(authority, "authority");
  assertFileSource(schedules, "schedules");

  const store = createActionStoreFromEnv();
  const host =
    process.env.ADMIN_HOST ??
    process.env.ACTION_STORE_ADMIN_HOST ??
    "127.0.0.1";
  const port = Number(
    process.env.ADMIN_PORT ?? process.env.ACTION_STORE_ADMIN_PORT ?? "8787"
  );

  await createAdminServer({
    title: "Community engager",
    host,
    port,
    publicDir: adminShellPublicDir(),
    collections: [
      createActionStoreCollection(store, actions),
      createAllowlistCollection(allowlist),
      createJobsCollection(jobs),
      createRunsCollection(runs),
      createAuthorityCollection(authority),
      createSchedulesCollection(schedules),
    ],
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
