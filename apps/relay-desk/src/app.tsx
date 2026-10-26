/**
 * Relay Desk — HITL operator shell (Phase 0 scaffold).
 * Later: gateway seat + Feedback Broker cards + embedded noVNC.
 */
export function App() {
  return (
    <div class="desk">
      <header class="brand">
        <div class="brand-block">
          <span class="brand-name">Relay Desk</span>
          <span class="brand-sub">Operator · HITL · computer seat</span>
        </div>
        <p class="status" data-state="idle">
          Scaffold ready — connect gateway in Phase 1
        </p>
      </header>

      <main class="stage">
        <section class="hero-copy">
          <h1>Watch the seat. Approve the action.</h1>
          <p>
            Desktop shell for CommunityEngager HITL with an embedded
            computer-with-agent stream. Phase 0 is structure only — lease and
            noVNC land next.
          </p>
          <div class="cta-row">
            <button type="button" class="cta" disabled title="Phase 1">
              Open seat
            </button>
            <span class="hint">Requires COMPUTER_GATEWAY_URL (Phase 1)</span>
          </div>
        </section>
        <aside class="seat-placeholder" aria-label="Seat stream placeholder">
          <p>noVNC seat</p>
          <p class="muted">WebView loads lease.vnc_url after connect</p>
        </aside>
      </main>
    </div>
  );
}
