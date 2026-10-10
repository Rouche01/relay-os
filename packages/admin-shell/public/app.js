/**
 * Capability-driven admin SPA.
 * Talks only to /api/meta and /api/collections/* — no domain imports.
 */

const appTitle = document.getElementById("appTitle");
const sourceLine = document.getElementById("sourceLine");
const collectionNav = document.getElementById("collectionNav");
const statusFilterLabel = document.getElementById("statusFilterLabel");
const statusFilter = document.getElementById("statusFilter");
const limitFilter = document.getElementById("limitFilter");
const refreshBtn = document.getElementById("refreshBtn");
const chartsPane = document.getElementById("chartsPane");
const listHead = document.getElementById("listHead");
const listBody = document.getElementById("listBody");
const listEmpty = document.getElementById("listEmpty");
const detailPane = document.getElementById("detailPane");

/** @type {{ id: string; label: string; source: any; capabilities: any }[]} */
let collections = [];
/** @type {string | null} */
let collectionId = null;
/** @type {string | null} */
let selectedId = null;
/** @type {Record<string, unknown>[]} */
let rows = [];
/** @type {{ key: string; label: string }[]} */
let columns = [];
/** @type {'debug'|'scatter'|'funnel'} */
let chartMode = "debug";
/** @type {any[]} */
let lastSeriesPoints = [];
/** @type {any} */
let lastFunnel = null;
/** Aggregate Compare panel (series collections only); off by default. */
let compareOpen = false;

async function api(path, options) {
  const res = await fetch(path, {
    headers: { "content-type": "application/json", ...(options?.headers ?? {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replaceAll("'", "&#39;");
}

function currentCollection() {
  return collections.find((c) => c.id === collectionId) ?? null;
}

function rowId(row) {
  if (row.id != null) return String(row.id);
  if (row.name != null) return String(row.name);
  if (row.runId != null) return String(row.runId);
  return JSON.stringify(row);
}

function fmtCell(value) {
  if (value == null) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "object") return JSON.stringify(value).slice(0, 48);
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    try {
      return new Date(s).toLocaleString();
    } catch {
      return s;
    }
  }
  return s.length > 64 ? `${s.slice(0, 64)}…` : s;
}

function setMsg(el, text, kind) {
  if (!el) return;
  el.textContent = text;
  el.className = kind || "muted";
}

function renderNav() {
  collectionNav.innerHTML = "";
  for (const c of collections) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = c.label;
    btn.className = c.id === collectionId ? "active" : "";
    btn.addEventListener("click", () => switchCollection(c.id));
    collectionNav.appendChild(btn);
  }
}

function updateSourceLine() {
  const c = currentCollection();
  if (!c) {
    sourceLine.textContent = "No collections registered";
    return;
  }
  const loc =
    c.source.driver === "file"
      ? c.source.path
      : `postgres:${c.source.table ?? "?"}`;
  sourceLine.textContent = `${c.id} · ${c.source.driver} · ${loc}`;
}

async function switchCollection(id) {
  collectionId = id;
  selectedId = null;
  compareOpen = false;
  statusFilter.value = "";
  const caps = currentCollection()?.capabilities ?? {};
  statusFilterLabel.hidden = false;
  renderNav();
  updateSourceLine();
  detailPane.innerHTML = `<p class="muted">Select a row to inspect.</p>`;
  renderCompareChrome();
  await loadList();
}

function renderCompareChrome() {
  const caps = currentCollection()?.capabilities ?? {};
  if (!caps.series) {
    chartsPane.hidden = true;
    chartsPane.innerHTML = "";
    return;
  }
  chartsPane.hidden = false;
  if (!compareOpen) {
    chartsPane.innerHTML = `<div class="charts-toolbar"><button type="button" id="compareToggle" class="secondary">Compare runs</button><span class="muted" style="align-self:center">List is the picker — open a run for debug charts.</span></div>`;
    document.getElementById("compareToggle")?.addEventListener("click", () => {
      compareOpen = true;
      const params = listParams();
      loadCharts(params);
    });
    return;
  }
}

function listParams() {
  const params = new URLSearchParams();
  const limit = Number(limitFilter.value);
  if (Number.isFinite(limit) && limit > 0) params.set("limit", String(limit));
  if (statusFilter.value.trim()) params.set("status", statusFilter.value.trim());
  return params;
}

async function loadList() {
  if (!collectionId) return;
  const params = listParams();

  const data = await api(`/api/collections/${encodeURIComponent(collectionId)}?${params}`);
  columns = data.columns ?? [];
  rows = data.rows ?? [];
  renderList();

  const caps = currentCollection()?.capabilities ?? {};
  if (caps.series) {
    if (compareOpen) await loadCharts(params);
    else renderCompareChrome();
  } else {
    chartsPane.hidden = true;
  }

  if (selectedId && !rows.some((r) => rowId(r) === selectedId)) {
    selectedId = null;
    detailPane.innerHTML = `<p class="muted">Selected row no longer in list.</p>`;
  }
}

function renderList() {
  listHead.innerHTML = columns
    .map((c) => `<th>${escapeHtml(c.label)}</th>`)
    .join("");
  listBody.innerHTML = "";
  listEmpty.hidden = rows.length > 0;

  for (const row of rows) {
    const id = rowId(row);
    const tr = document.createElement("tr");
    if (id === selectedId) tr.classList.add("active");
    tr.innerHTML = columns
      .map((c) => {
        const v = row[c.key];
        const text = fmtCell(v);
        const cls =
          c.key === "status" || c.key === "runState"
            ? `badge ${escapeAttr(String(v ?? ""))}`
            : c.key.includes("preview") || c.key === "label" || c.key === "note"
              ? "preview"
              : "";
        return cls
          ? `<td><span class="${cls}">${escapeHtml(text)}</span></td>`
          : `<td>${escapeHtml(text)}</td>`;
      })
      .join("");
    tr.addEventListener("click", () => selectRow(id));
    listBody.appendChild(tr);
  }
}

const OUTCOME_COLORS = {
  approved: "var(--accent)",
  aborted: "var(--warn)",
  failed: "var(--danger)",
  empty: "var(--muted)",
};

async function loadCharts(params) {
  chartsPane.hidden = false;
  chartsPane.innerHTML = `<p class="chart-empty">Loading compare…</p>`;
  try {
    const data = await api(
      `/api/collections/${encodeURIComponent(collectionId)}/series?${params}`
    );
    lastSeriesPoints = data.points ?? [];
    lastFunnel = data.funnel ?? null;
    renderChartsPanel();
  } catch (err) {
    chartsPane.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
  }
}

function renderChartsPanel() {
  const points = lastSeriesPoints;
  const hideBtn = `<button type="button" id="compareHide" class="secondary">Hide compare</button>`;
  if (points.length === 0) {
    chartsPane.innerHTML = `<div class="charts-toolbar">${hideBtn}</div><p class="chart-empty">No run points in this window.</p>`;
    document.getElementById("compareHide")?.addEventListener("click", () => {
      compareOpen = false;
      renderCompareChrome();
    });
    return;
  }

  const modes = [
    { id: "debug", label: "Timeline" },
    { id: "scatter", label: "Duration × outcome" },
    { id: "funnel", label: "Scout funnel" },
  ];
  const toolbar = `<div class="charts-toolbar">${hideBtn}${modes
    .map(
      (m) =>
        `<button type="button" data-chart-mode="${m.id}" class="${m.id === chartMode ? "active" : ""}">${escapeHtml(m.label)}</button>`
    )
    .join("")}</div>`;

  let body = "";
  if (chartMode === "debug") {
    body =
      `<h3>Run timeline</h3>${renderGantt(points)}` +
      legendHtml([
        ["approved", OUTCOME_COLORS.approved],
        ["aborted", OUTCOME_COLORS.aborted],
        ["failed", OUTCOME_COLORS.failed],
        ["empty", OUTCOME_COLORS.empty],
      ]) +
      `<h3>HITL outcomes</h3>${renderStackedBars(points, ["approved", "aborted", "failed"])}` +
      legendHtml([
        ["approved", OUTCOME_COLORS.approved],
        ["aborted", OUTCOME_COLORS.aborted],
        ["failed", OUTCOME_COLORS.failed],
      ]);
  } else if (chartMode === "scatter") {
    body =
      `<h3>Duration × dominant outcome</h3>${renderScatter(points)}` +
      legendHtml([
        ["approved", OUTCOME_COLORS.approved],
        ["aborted", OUTCOME_COLORS.aborted],
        ["failed", OUTCOME_COLORS.failed],
        ["empty", OUTCOME_COLORS.empty],
      ]);
  } else {
    body = `<h3>Window funnel</h3>${renderFunnel(lastFunnel, points)}`;
  }

  chartsPane.innerHTML = toolbar + body;
  document.getElementById("compareHide")?.addEventListener("click", () => {
    compareOpen = false;
    renderCompareChrome();
  });
  chartsPane.querySelectorAll("[data-chart-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      chartMode = btn.getAttribute("data-chart-mode") || "debug";
      renderChartsPanel();
    });
  });
  chartsPane.querySelectorAll("[data-run-id]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.getAttribute("data-run-id");
      if (id) selectRow(id);
    });
  });
}

function legendHtml(items) {
  return `<div class="legend">${items
    .map(
      ([label, color]) =>
        `<span style="--swatch:${color}">${escapeHtml(label)}</span>`
    )
    .join("")}</div>`;
}

function parseTime(iso) {
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : NaN;
}

function outcomeOf(p) {
  return p.outcome || "empty";
}

/** Shared time-axis Gantt: one lane per run, colored by dominant outcome. */
function renderGantt(points) {
  const starts = points.map((p) => parseTime(p.startedAt || p.t));
  const ends = points.map((p) => parseTime(p.t));
  const t0 = Math.min(...starts.filter(Number.isFinite));
  const t1 = Math.max(...ends.filter(Number.isFinite));
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) {
    return `<p class="chart-empty">Need startedAt/endedAt for timeline.</p>`;
  }
  const span = t1 - t0;
  const labelW = 72;
  const w = 520;
  const laneH = 18;
  const padTop = 8;
  const padBot = 20;
  const h = padTop + points.length * laneH + padBot;
  const plotL = labelW;
  const plotR = w - 8;
  const plotW = plotR - plotL;

  const lanes = points
    .map((p, i) => {
      const s = parseTime(p.startedAt || p.t);
      const e = parseTime(p.t);
      if (!Number.isFinite(s) || !Number.isFinite(e)) return "";
      const x = plotL + ((s - t0) / span) * plotW;
      const width = Math.max(3, ((e - s) / span) * plotW);
      const y = padTop + i * laneH + 3;
      const color = OUTCOME_COLORS[outcomeOf(p)] || OUTCOME_COLORS.empty;
      const label = String(p.runId || "").slice(-10);
      const title = `${p.runId}: ${Math.round((Number(p.durationMs) || 0) / 1000)}s · ${outcomeOf(p)} · scouted=${p.scouted} jobs=${p.jobs}`;
      return (
        `<text x="4" y="${y + 11}" fill="var(--muted)" font-size="9" font-family="var(--mono)">${escapeHtml(label)}</text>` +
        `<rect x="${x}" y="${y}" width="${width}" height="12" rx="2" fill="${color}" data-run-id="${escapeAttr(p.runId || "")}" style="cursor:pointer"><title>${escapeHtml(title)}</title></rect>`
      );
    })
    .join("");

  const axisY = h - 8;
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="run timeline">${lanes}<line x1="${plotL}" y1="${axisY}" x2="${plotR}" y2="${axisY}" stroke="var(--line)" /><text x="${plotL}" y="${h - 2}" fill="var(--muted)" font-size="9">${escapeHtml(new Date(t0).toLocaleString())}</text><text x="${plotR}" y="${h - 2}" fill="var(--muted)" font-size="9" text-anchor="end">${escapeHtml(new Date(t1).toLocaleString())}</text></svg>`;
}

function renderStackedBars(points, keys) {
  const w = 520;
  const h = 140;
  const pad = 16;
  const totals = points.map((p) =>
    keys.reduce((sum, k) => sum + (Number(p[k]) || 0), 0)
  );
  const max = Math.max(...totals, 1);
  const gap = 3;
  const slot = (w - pad * 2) / points.length;
  const barW = Math.max(4, slot - gap);
  const rects = [];
  points.forEach((p, i) => {
    const x = pad + i * slot;
    let y = h - pad;
    for (const k of keys) {
      const v = Number(p[k]) || 0;
      if (v <= 0) continue;
      const bh = (v / max) * (h - pad * 2);
      y -= bh;
      rects.push(
        `<rect x="${x}" y="${y}" width="${barW}" height="${bh}" fill="${OUTCOME_COLORS[k] || "var(--muted)"}" data-run-id="${escapeAttr(p.runId || "")}" style="cursor:pointer"><title>${escapeHtml(String(p.runId))}: ${k}=${v}</title></rect>`
      );
    }
  });
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="outcomes chart">${rects.join("")}</svg>`;
}

/** X = durationMs, Y = jitter by outcome band, color = outcome. */
function renderScatter(points) {
  const w = 520;
  const h = 180;
  const pad = 28;
  const durations = points.map((p) => Number(p.durationMs) || 0);
  const maxD = Math.max(...durations, 1);
  const bands = { approved: 0.2, aborted: 0.45, failed: 0.7, empty: 0.9 };
  const dots = points
    .map((p) => {
      const outcome = outcomeOf(p);
      const x = pad + ((Number(p.durationMs) || 0) / maxD) * (w - pad * 2);
      const base = bands[outcome] ?? 0.5;
      const jitter =
        (((String(p.runId || "").length * 17) % 11) - 5) / 100;
      const y = pad + (base + jitter) * (h - pad * 2);
      const r = 5 + Math.min(4, (Number(p.jobs) || 0));
      const title = `${p.runId}: ${Math.round((Number(p.durationMs) || 0) / 1000)}s · ${outcome} · jobs=${p.jobs}`;
      return `<circle cx="${x}" cy="${y}" r="${r}" fill="${OUTCOME_COLORS[outcome] || OUTCOME_COLORS.empty}" opacity="0.85" data-run-id="${escapeAttr(p.runId || "")}" style="cursor:pointer"><title>${escapeHtml(title)}</title></circle>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="duration scatter"><text x="${pad}" y="${h - 8}" fill="var(--muted)" font-size="9">0s</text><text x="${w - pad}" y="${h - 8}" fill="var(--muted)" font-size="9" text-anchor="end">${Math.round(maxD / 1000)}s</text>${dots}</svg>`;
}

function renderFunnel(funnel, points) {
  const f = funnel || {
    scouted: points.reduce((s, p) => s + (Number(p.scouted) || 0), 0),
    jobs: points.reduce((s, p) => s + (Number(p.jobs) || 0), 0),
    approved: points.reduce((s, p) => s + (Number(p.approved) || 0), 0),
    aborted: points.reduce((s, p) => s + (Number(p.aborted) || 0), 0),
    failed: points.reduce((s, p) => s + (Number(p.failed) || 0), 0),
    posted: points.reduce((s, p) => s + (Number(p.posted) || 0), 0),
  };
  const stages = [
    { key: "scouted", label: "Scouted", color: "var(--muted)" },
    { key: "jobs", label: "Jobs", color: "var(--text)" },
    { key: "approved", label: "Approved", color: OUTCOME_COLORS.approved },
    { key: "posted", label: "Posted", color: OUTCOME_COLORS.approved },
    { key: "aborted", label: "Aborted", color: OUTCOME_COLORS.aborted },
    { key: "failed", label: "Failed", color: OUTCOME_COLORS.failed },
  ];
  const max = Math.max(...stages.map((s) => Number(f[s.key]) || 0), 1);
  const w = 520;
  const rowH = 26;
  const pad = 12;
  const labelW = 72;
  const h = pad * 2 + stages.length * rowH;
  const bars = stages
    .map((s, i) => {
      const v = Number(f[s.key]) || 0;
      const y = pad + i * rowH;
      const bw = ((w - labelW - pad * 2) * v) / max;
      return (
        `<text x="${pad}" y="${y + 14}" fill="var(--muted)" font-size="11">${escapeHtml(s.label)}</text>` +
        `<rect x="${labelW}" y="${y + 2}" width="${Math.max(bw, v > 0 ? 2 : 0)}" height="16" rx="2" fill="${s.color}" />` +
        `<text x="${labelW + bw + 6}" y="${y + 14}" fill="var(--text)" font-size="11">${v}</text>`
      );
    })
    .join("");
  const blocked = points.reduce((s, p) => s + (Number(p.blockedCount) || 0), 0);
  const timedOut = points.reduce((s, p) => s + (Number(p.timedOutCount) || 0), 0);
  const note =
    blocked || timedOut
      ? `<p class="muted" style="margin-top:0.5rem">Scout walls in window: blocked=${blocked}, timedOut=${timedOut}</p>`
      : "";
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="scout funnel">${bars}</svg>${note}`;
}

async function selectRow(id) {
  selectedId = id;
  renderList();
  detailPane.innerHTML = `<p class="muted">Loading ${escapeHtml(id)}…</p>`;
  try {
    const data = await api(
      `/api/collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(id)}`
    );
    renderDetail(id, data);
  } catch (err) {
    detailPane.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
  }
}

function stageTone(ok) {
  if (ok === true) return "ok";
  if (ok === false) return "fail";
  return "unknown";
}

function renderRunDebug(viz) {
  if (!viz || typeof viz !== "object") return "";
  const stages = Array.isArray(viz.stages) ? viz.stages : [];
  const jobs = Array.isArray(viz.jobs) ? viz.jobs : [];
  const scout = viz.scout ?? {};
  const funnel = viz.funnel ?? {};
  const subs = Array.isArray(scout.subs) ? scout.subs : [];

  const stageHtml = stages
    .map((s) => {
      const tone = stageTone(s.ok);
      const wait =
        s.waitMs != null && s.waitMs > 0
          ? `<span class="muted"> wait ${Math.round(s.waitMs / 1000)}s</span>`
          : "";
      return `<div class="run-stage run-stage-${tone}"><strong>${escapeHtml(s.label)}</strong>${wait}<div class="muted">${escapeHtml(s.note || "—")}</div></div>`;
    })
    .join("");

  const funnelSvg = renderFunnel(funnel, [
    {
      blockedCount: scout.blockedCount ?? 0,
      timedOutCount: scout.timedOutCount ?? 0,
    },
  ]);

  const jobsRows =
    jobs.length === 0
      ? `<tr><td colspan="4" class="muted">No jobs in this run.</td></tr>`
      : jobs
          .map((j) => {
            const link = j.postedUrl
              ? `<a href="${escapeAttr(j.postedUrl)}" target="_blank" rel="noopener">post</a>`
              : "—";
            const title = j.title || j.id || "—";
            const err = j.error
              ? `<div class="error" style="font-size:0.8rem">${escapeHtml(j.error)}</div>`
              : "";
            return `<tr>
              <td><span class="badge ${escapeAttr(j.outcome || "")}">${escapeHtml(j.outcome || "?")}</span></td>
              <td>${escapeHtml(j.subreddit || "—")}</td>
              <td>${escapeHtml(title)}${err}</td>
              <td>${link}</td>
            </tr>`;
          })
          .join("");

  const scoutNote = [
    scout.listingOk === true
      ? "listingOk"
      : scout.listingOk === false
        ? "no-listing"
        : null,
    `blocked=${scout.blockedCount ?? 0}`,
    `timedOut=${scout.timedOutCount ?? 0}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const subsRows =
    subs.length === 0
      ? `<tr><td colspan="4" class="muted">No per-sub rows.</td></tr>`
      : subs
          .map(
            (s) => `<tr>
              <td>${escapeHtml(s.subreddit)}</td>
              <td><span class="badge ${escapeAttr(s.status || "")}">${escapeHtml(s.status || "—")}</span></td>
              <td>${escapeHtml(String(s.opportunities ?? 0))}</td>
              <td class="preview">${escapeHtml(s.reason || "—")}</td>
            </tr>`
          )
          .join("");

  return `
    <div class="run-debug">
      <h3>Stages</h3>
      <div class="run-stages">${stageHtml || `<p class="muted">No stage data.</p>`}</div>
      <h3>Funnel</h3>
      ${funnelSvg}
      <h3>Jobs</h3>
      <table class="run-table">
        <thead><tr><th>Outcome</th><th>Sub</th><th>Thread</th><th>Post</th></tr></thead>
        <tbody>${jobsRows}</tbody>
      </table>
      <h3>Scout</h3>
      <p class="muted">${escapeHtml(scoutNote)}</p>
      <table class="run-table">
        <thead><tr><th>Subreddit</th><th>Status</th><th>Opps</th><th>Reason</th></tr></thead>
        <tbody>${subsRows}</tbody>
      </table>
    </div>
  `;
}

function renderDetail(id, data) {
  const caps = currentCollection()?.capabilities ?? {};
  const record = data.record;
  const detail = data.detail ?? {};
  const title = detail.title || id;
  const subtitle = detail.subtitle || detail.kind || "";
  const editable = detail.editable ?? [];
  const actions = caps.actions ?? [];
  const debugHtml =
    detail.kind === "run-debug" && detail.viz ? renderRunDebug(detail.viz) : "";

  const editFields =
    caps.patch && editable.length > 0
      ? editable
          .map((key) => {
            const val =
              record && typeof record === "object" && !Array.isArray(record)
                ? record[key]
                : undefined;
            const isLong =
              typeof val === "string" && (val.length > 80 || String(val).includes("\n"));
            if (typeof val === "boolean") {
              return `<div class="field"><label style="text-transform:none;letter-spacing:0;color:var(--text)"><input type="checkbox" data-field="${escapeAttr(key)}" ${val ? "checked" : ""} /> ${escapeHtml(key)}</label></div>`;
            }
            if (isLong || key.toLowerCase().includes("text") || key === "note") {
              return `<div class="field"><label for="f-${escapeAttr(key)}">${escapeHtml(key)}</label><textarea id="f-${escapeAttr(key)}" data-field="${escapeAttr(key)}">${escapeHtml(val ?? "")}</textarea></div>`;
            }
            return `<div class="field"><label for="f-${escapeAttr(key)}">${escapeHtml(key)}</label><input id="f-${escapeAttr(key)}" data-field="${escapeAttr(key)}" value="${escapeAttr(val ?? "")}" /></div>`;
          })
          .join("")
      : "";

  detailPane.innerHTML = `
    <div class="detail-head">
      <div>
        <h2>${escapeHtml(title)}</h2>
        <p class="muted">${escapeHtml(subtitle)}</p>
      </div>
      <div class="actions">
        ${actions.map((a) => `<button type="button" class="secondary" data-action="${escapeAttr(a)}">${escapeHtml(a)}</button>`).join("")}
        ${caps.delete ? `<button type="button" class="danger" id="deleteBtn">Delete</button>` : ""}
      </div>
    </div>
    ${debugHtml}
    ${editFields}
    ${caps.patch && editable.length ? `<div class="actions"><button type="button" id="saveBtn">Save</button></div>` : ""}
    <p id="detailMsg" class="muted"></p>
    <div class="field" style="margin-top:1rem">
      <label>Raw</label>
      <pre class="raw" style="max-height:${debugHtml ? "30vh" : "50vh"}">${escapeHtml(JSON.stringify(record, null, 2))}</pre>
    </div>
  `;

  const msg = document.getElementById("detailMsg");

  document.getElementById("saveBtn")?.addEventListener("click", async () => {
    setMsg(msg, "Saving…");
    try {
      const body = {};
      detailPane.querySelectorAll("[data-field]").forEach((el) => {
        const key = el.getAttribute("data-field");
        if (!key) return;
        if (el.type === "checkbox") body[key] = el.checked;
        else if (el.type === "number") body[key] = Number(el.value);
        else body[key] = el.value;
      });
      const next = await api(
        `/api/collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(id)}`,
        { method: "PATCH", body: JSON.stringify(body) }
      );
      setMsg(msg, "Saved.", "ok");
      await loadList();
      renderDetail(id, next);
    } catch (err) {
      setMsg(msg, err.message, "error");
    }
  });

  detailPane.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const name = btn.getAttribute("data-action");
      if (!name) return;
      let body = {};
      if (name === "status") {
        const status = window.prompt("New status (e.g. approved, aborted, edited):");
        if (!status) return;
        body = { status: status.trim() };
      }
      setMsg(msg, `${name}…`);
      try {
        const next = await api(
          `/api/collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(id)}/actions/${encodeURIComponent(name)}`,
          { method: "POST", body: JSON.stringify(body) }
        );
        setMsg(msg, `Action ${name} ok.`, "ok");
        await loadList();
        renderDetail(id, next);
      } catch (err) {
        setMsg(msg, err.message, "error");
      }
    });
  });

  document.getElementById("deleteBtn")?.addEventListener("click", async () => {
    if (!confirm(`Delete ${id}?`)) return;
    try {
      await api(
        `/api/collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      selectedId = null;
      detailPane.innerHTML = `<p class="ok">Deleted ${escapeHtml(id)}</p>`;
      await loadList();
    } catch (err) {
      setMsg(msg, err.message, "error");
    }
  });
}

async function init() {
  const meta = await api("/api/meta");
  appTitle.textContent = meta.title || "Relay data";
  document.title = meta.title || "Relay admin";
  collections = meta.collections ?? [];
  if (collections.length === 0) {
    sourceLine.textContent = "No collections registered";
    return;
  }
  refreshBtn.addEventListener("click", () => loadList());
  statusFilter.addEventListener("change", () => loadList());
  limitFilter.addEventListener("change", () => loadList());
  await switchCollection(collections[0].id);
}

init().catch((err) => {
  sourceLine.textContent = err.message;
  sourceLine.classList.add("error");
});
