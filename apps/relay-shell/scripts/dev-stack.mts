/**
 * Start Spec API + Vite together for local shell development.
 *
 *   pnpm --filter @relay/apps-relay-shell dev:all
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = (name: string): string => {
  const local = path.join(root, "node_modules", ".bin", name);
  if (existsSync(local)) return local;
  const hoisted = path.join(root, "..", "..", "node_modules", ".bin", name);
  if (existsSync(hoisted)) return hoisted;
  return name;
};

const host = process.env.SPEC_UI_HOST ?? "127.0.0.1";
const port = process.env.SPEC_UI_PORT ?? "8790";
const children: ChildProcess[] = [];

function run(label: string, command: string, args: string[]): ChildProcess {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code, signal) => {
    if (signal) return;
    if (code && code !== 0) {
      console.error(`[dev-stack] ${label} exited ${code}`);
      shutdown(code);
    }
  });
  children.push(child);
  return child;
}

function shutdown(code = 0): void {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log(`[dev-stack] Spec API → http://${host}:${port}`);
console.log(`[dev-stack] Vite     → http://127.0.0.1:5173 (proxies /api)`);

run("api", bin("tsx"), ["server/api.ts"]);
run("vite", bin("vite"), []);
