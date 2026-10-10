#!/usr/bin/env node
import { loadActionStoreEnv } from "./load-env.js";
import { createActionStoreFromEnv } from "./factory.js";
import {
  deleteAction,
  editActionField,
  getAction,
  isActionStatus,
  listActions,
  setActionStatus,
} from "./admin-ops.js";
import type { ActionListFilter, ActionStatus } from "./types.js";

function usage(): never {
  console.log(`Usage:
  relay-actions list [--status S] [--app-id ID] [--limit N]
  relay-actions get <id>
  relay-actions edit <id> --field <key> --value <str>
  relay-actions edit <id> --field <key> --file -
  relay-actions status <id> <nextStatus>
  relay-actions delete <id>
  relay-actions admin   # print GUI start hint

Env: ACTION_STORE, ACTION_STORE_PATH, ACTION_STORE_ADMIN_PORT, ACTION_STORE_ENV_FILE
Loads .env from cwd, or apps/community-engager/.env when run from this package.
`);
  process.exit(1);
}

function payloadPreview(record: { payload: unknown }): string {
  const p = record.payload as { draftText?: string; subreddit?: string } | null;
  const text = (p?.draftText ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  const sub = p?.subreddit ? `r/${p.subreddit}` : "-";
  return `${sub}  ${text || "—"}`;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseArgs(argv: string[]): {
  cmd: string;
  positional: string[];
  flags: Record<string, string | boolean>;
} {
  const [cmd = "", ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { cmd, positional, flags };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  const { cmd, positional, flags } = parseArgs(argv);
  if (!cmd || cmd === "help" || cmd === "-h" || cmd === "--help") usage();

  if (cmd === "admin") {
    const port = process.env.ACTION_STORE_ADMIN_PORT ?? "8787";
    console.log(
      `Start the GUI with:\n  pnpm --filter @relay/action-store admin\nThen open http://127.0.0.1:${port}`
    );
    return;
  }

  loadActionStoreEnv();
  const store = createActionStoreFromEnv();

  if (cmd === "list") {
    const filter: ActionListFilter = {};
    if (typeof flags["app-id"] === "string") filter.appId = flags["app-id"];
    if (typeof flags.status === "string") {
      if (!isActionStatus(flags.status)) {
        throw new Error(`Invalid status: ${flags.status}`);
      }
      filter.status = flags.status;
    }
    if (typeof flags.limit === "string") {
      filter.limit = Number(flags.limit);
    }
    const rows = await listActions(store, filter);
    for (const r of rows) {
      console.log(
        `${r.updatedAt}  ${r.status.padEnd(16)}  ${r.id}  ${payloadPreview(r)}`
      );
    }
    console.log(`(${rows.length} record${rows.length === 1 ? "" : "s"})`);
    return;
  }

  if (cmd === "get") {
    const id = positional[0];
    if (!id) usage();
    const record = await getAction(store, id);
    if (!record) {
      console.error(`Action not found: ${id}`);
      process.exit(1);
    }
    console.log(JSON.stringify(record, null, 2));
    return;
  }

  if (cmd === "edit") {
    const id = positional[0];
    const field = flags.field;
    if (!id || typeof field !== "string") usage();
    let value: string;
    if (flags.file === "-" || flags.file === true) {
      value = await readStdin();
    } else if (typeof flags.value === "string") {
      value = flags.value;
    } else {
      usage();
    }
    const record = await editActionField(store, id, field, value);
    console.log(JSON.stringify(record, null, 2));
    return;
  }

  if (cmd === "status") {
    const id = positional[0];
    const next = positional[1];
    if (!id || !next) usage();
    if (!isActionStatus(next)) {
      throw new Error(`Invalid status: ${next}`);
    }
    const record = await setActionStatus(store, id, next as ActionStatus);
    console.log(JSON.stringify(record, null, 2));
    return;
  }

  if (cmd === "delete") {
    const id = positional[0];
    if (!id) usage();
    const removed = await deleteAction(store, id);
    if (!removed) {
      console.error(`Action not found: ${id}`);
      process.exit(1);
    }
    console.log(`deleted ${id}`);
    return;
  }

  usage();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
