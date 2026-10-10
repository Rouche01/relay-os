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
  statusFilter.value = "";
  const caps = currentCollection()?.capabilities ?? {};
  statusFilterLabel.hidden = false;
  renderNav();
  updateSourceLine();
  detailPane.innerHTML = `<p class="muted">Select a row to inspect.</p>`;
  chartsPane.hidden = !caps.series;
  await loadList();
}

async function loadList() {
  if (!collectionId) return;
  const params = new URLSearchParams();
  const limit = Number(limitFilter.value);
  if (Number.isFinite(limit) && limit > 0) params.set("limit", String(limit));
  if (statusFilter.value.trim()) params.set("status", statusFilter.value.trim());

  const data = await api(`/api/collections/${encodeURIComponent(collectionId)}?${params}`);
  columns = data.columns ?? [];
  rows = data.rows ?? [];
  renderList();

  const caps = currentCollection()?.capabilities ?? {};
  if (caps.series) await loadCharts(params);

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

async function loadCharts(params) {
  chartsPane.hidden = false;
  chartsPane.innerHTML = `<h3>Series</h3><p class="chart-empty">Loading…</p>`;
  try {
    const data = await api(
      `/api/collections/${encodeURIComponent(collectionId)}/series?${params}`
    );
    const points = data.points ?? [];
    if (points.length === 0) {
      chartsPane.innerHTML = `<h3>Series</h3><p class="chart-empty">No points.</p>`;
      return;
    }
    const numericKeys = Object.keys(points[0]).filter(
      (k) => k !== "t" && k !== "runId" && typeof points[0][k] === "number"
    );
    const key = numericKeys[0] ?? null;
    if (!key) {
      chartsPane.innerHTML = `<h3>Series</h3><p class="chart-empty">No numeric series.</p>`;
      return;
    }
    chartsPane.innerHTML = `<h3>${escapeHtml(key)} over time</h3>${renderLineSvg(points, key)}`;
    chartsPane.querySelectorAll("[data-run-id]").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.getAttribute("data-run-id");
        if (id) selectRow(id);
      });
    });
  } catch (err) {
    chartsPane.innerHTML = `<h3>Series</h3><p class="error">${escapeHtml(err.message)}</p>`;
  }
}

function renderLineSvg(points, key) {
  const w = 480;
  const h = 120;
  const pad = 16;
  const values = points.map((p) => Number(p[key]) || 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const coords = points.map((p, i) => {
    const x = pad + (i / Math.max(points.length - 1, 1)) * (w - pad * 2);
    const y = h - pad - ((Number(p[key]) - min) / span) * (h - pad * 2);
    return { x, y, id: p.runId || "" };
  });
  const d = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x},${c.y}`).join(" ");
  const dots = coords
    .map(
      (c) =>
        `<circle cx="${c.x}" cy="${c.y}" r="4" fill="var(--accent)" data-run-id="${escapeAttr(c.id)}" style="cursor:pointer" />`
    )
    .join("");
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeAttr(key)} chart"><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2" />${dots}</svg>`;
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

function renderDetail(id, data) {
  const caps = currentCollection()?.capabilities ?? {};
  const record = data.record;
  const detail = data.detail ?? {};
  const title = detail.title || id;
  const subtitle = detail.subtitle || detail.kind || "";
  const editable = detail.editable ?? [];
  const actions = caps.actions ?? [];

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
    ${editFields}
    ${caps.patch && editable.length ? `<div class="actions"><button type="button" id="saveBtn">Save</button></div>` : ""}
    <p id="detailMsg" class="muted"></p>
    <div class="field" style="margin-top:1rem">
      <label>Raw</label>
      <pre class="raw" style="max-height:50vh">${escapeHtml(JSON.stringify(record, null, 2))}</pre>
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
