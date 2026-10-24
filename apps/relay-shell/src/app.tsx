import { useEffect, useState } from "preact/hooks";

/**
 * Relay product shell — Spec governance first; living-todo mounts later.
 * Hash routes for now (no router dep until living-todo needs one).
 */
export function App() {
  const [path, setPath] = useState(readHashPath);

  useEffect(() => {
    const onHash = () => setPath(readHashPath());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div class="shell">
      <header class="brand">
        <a href="#/" class="brand-link">
          <span class="brand-name">Relay</span>
          <span class="brand-sub">Intent → Spec</span>
        </a>
        <nav class="nav">
          <a
            href="#/"
            class={path === "/" || path.startsWith("/spec") ? "active" : ""}
          >
            Specs
          </a>
          <a href="#/todo" class={path.startsWith("/todo") ? "active" : ""}>
            Living todo
          </a>
        </nav>
      </header>
      <main>
        {path.startsWith("/todo") ? <TodoStub /> : <ShellHome path={path} />}
      </main>
    </div>
  );
}

function readHashPath(): string {
  return location.hash.replace(/^#/, "") || "/";
}

function ShellHome({ path }: { path: string }) {
  return (
    <section>
      <p class="eyebrow">Shell</p>
      <h1>Relay shell</h1>
      <p class="lede">
        Preact scaffold ready. Spec list / review ports next. Current route:{" "}
        <code>{path}</code>
      </p>
      <p class="lede muted">
        Spec API (this app):{" "}
        <code>pnpm --filter @relay/apps-relay-shell api</code> — proxied at{" "}
        <code>/api</code>. Not CommunityEngager-bound.
      </p>
    </section>
  );
}

function TodoStub() {
  return (
    <section>
      <p class="eyebrow">Coming soon</p>
      <h1>Living todo</h1>
      <p class="lede">
        Queue + in-card HITL will mount here. See{" "}
        <code>relay_living_todo_shell.plan.md</code>.
      </p>
    </section>
  );
}
