/**
 * Spec governance API — app-agnostic (Relay shell).
 * Not CommunityEngager-bound. Packs for "New from Intent" use relay/compose.
 *
 *   pnpm --filter @relay/apps-relay-shell api
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import {
  composeIntentFromSlots,
  createSpecBundle,
  freezeSpec,
  markSpecAborted,
  markSpecRunning,
} from "@relay/protocol";
import { createFileSpecStore } from "@relay/spec-store";
import { relayComposePack } from "./generic-pack.js";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function dataDir(): string {
  return path.resolve(
    process.cwd(),
    process.env.RELAY_DATA_DIR?.trim() || ".data"
  );
}

async function main(): Promise<void> {
  const store = createFileSpecStore(dataDir());
  const host = process.env.SPEC_UI_HOST ?? "127.0.0.1";
  const port = Number(process.env.SPEC_UI_PORT ?? "8790");

  const server = createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type",
        });
        res.end();
        return;
      }

      const url = new URL(req.url ?? "/", `http://${host}:${port}`);
      const method = req.method ?? "GET";

      if (method === "GET" && url.pathname === "/api/health") {
        sendJson(res, 200, { ok: true, store: store.path });
        return;
      }

      if (method === "GET" && url.pathname === "/api/specs") {
        const records = await store.list({ limit: 100 });
        sendJson(res, 200, { records, path: store.path });
        return;
      }

      const one = /^\/api\/specs\/([^/]+)$/.exec(url.pathname);
      if (method === "GET" && one?.[1]) {
        const id = decodeURIComponent(one[1]);
        const bundle = await store.get(id);
        if (!bundle) {
          sendJson(res, 404, { error: `Spec not found: ${id}` });
          return;
        }
        sendJson(res, 200, bundle);
        return;
      }

      if (method === "POST" && url.pathname === "/api/specs") {
        const raw = await readBody(req);
        const body = raw
          ? (JSON.parse(raw) as {
              goal?: string;
              slots?: Record<string, string | number | boolean | null>;
            })
          : {};
        const goal =
          body.goal?.trim() || "Compose a Spec from Intent under HITL";
        const { intent, spec, packId } = composeIntentFromSlots(
          goal,
          body.slots ?? { dryRun: true, maxJobs: 2 },
          { packs: [relayComposePack] }
        );
        const bundle = createSpecBundle(intent, spec, { appId: "relay" });
        await store.put(bundle);
        sendJson(res, 201, { ...bundle, packId });
        return;
      }

      const approve = /^\/api\/specs\/([^/]+)\/approve$/.exec(url.pathname);
      if (method === "POST" && approve?.[1]) {
        const id = decodeURIComponent(approve[1]);
        const bundle = await store.get(id);
        if (!bundle) {
          sendJson(res, 404, { error: `Spec not found: ${id}` });
          return;
        }
        let spec = bundle.spec;
        if (spec.status === "draft") {
          spec = freezeSpec(spec, { frozenBy: "relay-shell" });
        } else if (spec.status === "frozen") {
          spec = markSpecRunning(spec);
        } else {
          sendJson(res, 400, {
            error: `Cannot approve Spec in status "${spec.status}"`,
          });
          return;
        }
        const next = createSpecBundle(bundle.intent, spec, {
          appId: bundle.appId ?? "relay",
        });
        await store.put(next);
        sendJson(res, 200, next);
        return;
      }

      const abort = /^\/api\/specs\/([^/]+)\/abort$/.exec(url.pathname);
      if (method === "POST" && abort?.[1]) {
        const id = decodeURIComponent(abort[1]);
        const bundle = await store.get(id);
        if (!bundle) {
          sendJson(res, 404, { error: `Spec not found: ${id}` });
          return;
        }
        const spec = markSpecAborted(bundle.spec);
        const next = createSpecBundle(bundle.intent, spec, {
          appId: bundle.appId ?? "relay",
        });
        await store.put(next);
        sendJson(res, 200, next);
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, host, () => resolve());
    server.on("error", reject);
  });

  console.log(`=== Relay · Spec API (shell) ===`);
  console.log(`http://${host}:${port}`);
  console.log(`Spec store: ${store.path}`);
  console.log(`Pack: relay/compose (domain packs stay in their apps)\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
