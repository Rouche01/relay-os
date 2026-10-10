/** @typedef {'actions'|'allowlist'|'jobs'|'runs'} Collection */

const storePathEl = document.getElementById("storePath");
const collectionNav = document.getElementById("collectionNav");
const statusFilter = document.getElementById("statusFilter");
const statusFilterLabel = document.getElementById("statusFilterLabel");
const limitFilter = document.getElementById("limitFilter");
const refreshBtn = document.getElementById("refreshBtn");
const listHead = document.getElementById("listHead");
const listBody = document.getElementById("listBody");
const listEmpty = document.getElementById("listEmpty");
const detailPane = document.getElementById("detailPane");

/** @type {Collection} */
let collection = "actions";
/** @type {string | null} */
let selectedId = null;
/** @type {any[]} */
let rows = [];
/** @type {string[]} */
let actionStatuses = [];
/** @type {string[]} */
let allowlistStatuses = [];
/** @type {Record<string, string>} */
let paths = {};

const COLLECTIONS = [
  { id: "actions", label: "Actions" },
  { id: "allowlist", label: "Allowlist" },
  { id: "jobs", label: "Jobs" },
  { id: "runs", label: "Runs" },
];

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
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replaceAll("'", "&#39;");
}

function fmtTime(iso) {
  if (iso == null) return "—";
  if (typeof iso === "number") {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return String(iso);
    }
  }
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

function setMsg(el, text, kind) {
  if (!el) return;
  el.textContent = text;
  el.className = kind || "muted";
}

function renderNav() {
  collectionNav.innerHTML = "";
  for (const c of COLLECTIONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = c.label;
    btn.className = c.id === collection ? "active" : "";
    btn.addEventListener("click", () => switchCollection(c.id));
    collectionNav.appendChild(btn);
  }
}

function fillStatusOptions(values) {
  statusFilter.innerHTML = `<option value="">All</option>`;
  for (const s of values) {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    statusFilter.appendChild(opt);
  }
}

async function switchCollection(next) {
  collection = next;
  selectedId = null;
  statusFilter.value = "";
  if (collection === "actions") {
    statusFilterLabel.hidden = false;
    fillStatusOptions(actionStatuses);
  } else if (collection === "allowlist") {
    statusFilterLabel.hidden = false;
    fillStatusOptions(allowlistStatuses);
  } else {
    statusFilterLabel.hidden = true;
  }
  renderNav();
  detailPane.innerHTML = `<p class="muted">Select a row to inspect.</p>`;
  await loadList();
}

function rowId(row) {
  if (collection === "actions") return row.id;
  if (collection === "allowlist") return row.name;
  return row.id;
}

function renderList() {
  if (collection === "actions") {
    listHead.innerHTML = `<th>Updated</th><th>Status</th><th>Sub</th><th>Preview</th>`;
  } else if (collection === "allowlist") {
    listHead.innerHTML = `<th>Updated</th><th>Status</th><th>Sub</th><th>Score</th><th>Note</th>`;
  } else if (collection === "jobs") {
    listHead.innerHTML = `<th>Updated</th><th>OK</th><th>Transport</th><th>Preview</th>`;
  } else {
    listHead.innerHTML = `<th>Ended</th><th>State</th><th>Scouted</th><th>Jobs</th><th>Preview</th>`;
  }

  listBody.innerHTML = "";
  listEmpty.hidden = rows.length > 0;

  for (const row of rows) {
    const id = rowId(row);
    const tr = document.createElement("tr");
    if (id === selectedId) tr.classList.add("active");

    if (collection === "actions") {
      const p = row.payload && typeof row.payload === "object" ? row.payload : {};
      const text = (typeof p.draftText === "string" ? p.draftText : "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
      tr.innerHTML = `
        <td>${escapeHtml(fmtTime(row.updatedAt))}</td>
        <td><span class="badge ${escapeAttr(row.status)}">${escapeHtml(row.status)}</span></td>
        <td>${p.subreddit ? `r/${escapeHtml(String(p.subreddit))}` : "—"}</td>
        <td class="preview">${escapeHtml(text || "—")}</td>`;
    } else if (collection === "allowlist") {
      tr.innerHTML = `
        <td>${escapeHtml(fmtTime(row.updatedAt))}</td>
        <td><span class="badge ${escapeAttr(row.status)}">${escapeHtml(row.status)}</span></td>
        <td>r/${escapeHtml(row.name)}</td>
        <td>${escapeHtml(String(row.score))}</td>
        <td class="preview">${escapeHtml((row.note || "").slice(0, 60) || "—")}</td>`;
    } else if (collection === "jobs") {
      const okClass =
        row.ok === true ? "ok-true" : row.ok === false ? "ok-false" : "";
      tr.innerHTML = `
        <td>${escapeHtml(fmtTime(row.mtimeMs))}</td>
        <td><span class="badge ${okClass}">${row.ok === true ? "ok" : row.ok === false ? "fail" : "—"}</span></td>
        <td>${escapeHtml(row.transport || "—")}</td>
        <td class="preview">${escapeHtml(row.preview || "—")}</td>`;
    } else {
      tr.innerHTML = `
        <td>${escapeHtml(fmtTime(row.endedAt || row.mtimeMs))}</td>
        <td><span class="badge">${escapeHtml(row.runState || "—")}</span></td>
        <td>${row.scouted ?? "—"}</td>
        <td>${row.jobs ?? "—"}</td>
        <td class="preview">${escapeHtml(row.preview || "—")}</td>`;
    }

    tr.addEventListener("click", () => selectRow(id));
    listBody.appendChild(tr);
  }
}

async function loadList() {
  const params = new URLSearchParams();
  const limit = Number(limitFilter.value);
  if (Number.isFinite(limit) && limit > 0) params.set("limit", String(limit));
  if (
    (collection === "actions" || collection === "allowlist") &&
    statusFilter.value
  ) {
    params.set("status", statusFilter.value);
  }

  if (collection === "actions") {
    const data = await api(`/api/actions?${params}`);
    rows = data.records ?? [];
  } else if (collection === "allowlist") {
    const data = await api(`/api/allowlist?${params}`);
    rows = data.entries ?? [];
  } else if (collection === "jobs") {
    const data = await api(`/api/jobs?${params}`);
    rows = data.jobs ?? [];
  } else {
    const data = await api(`/api/runs?${params}`);
    rows = data.runs ?? [];
  }

  renderList();
  if (selectedId && !rows.some((r) => rowId(r) === selectedId)) {
    selectedId = null;
    detailPane.innerHTML = `<p class="muted">Selected row no longer in list.</p>`;
  }
}

async function selectRow(id) {
  selectedId = id;
  renderList();
  detailPane.innerHTML = `<p class="muted">Loading ${escapeHtml(id)}…</p>`;
  try {
    if (collection === "actions") {
      const { record } = await api(`/api/actions/${encodeURIComponent(id)}`);
      renderActionDetail(record);
    } else if (collection === "allowlist") {
      const { entry } = await api(`/api/allowlist/${encodeURIComponent(id)}`);
      renderAllowlistDetail(entry);
    } else if (collection === "jobs") {
      const data = await api(`/api/jobs/${encodeURIComponent(id)}`);
      renderFileDetail("Job", data.file, data.record, async () => {
        await api(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
      });
    } else {
      const data = await api(`/api/runs/${encodeURIComponent(id)}`);
      renderFileDetail("Run", data.file, data.record, async () => {
        await api(`/api/runs/${encodeURIComponent(id)}`, { method: "DELETE" });
      });
    }
  } catch (err) {
    detailPane.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
  }
}

function renderActionDetail(record) {
  const p = record.payload && typeof record.payload === "object" ? record.payload : {};
  const draftText = typeof p.draftText === "string" ? p.draftText : "";
  const nextStatuses = actionStatuses.filter((s) => s !== record.status);

  detailPane.innerHTML = `
    <div class="detail-head">
      <div>
        <h2>${escapeHtml(record.id)}</h2>
        <p class="muted">${escapeHtml(record.appId)} · ${escapeHtml(fmtTime(record.createdAt))}</p>
      </div>
      <div class="actions">
        <button type="button" class="danger" id="deleteBtn">Delete</button>
      </div>
    </div>
    <div class="meta-grid">
      <div><strong>Status</strong><span class="badge ${escapeAttr(record.status)}">${escapeHtml(record.status)}</span></div>
      <div><strong>Subreddit</strong>${p.subreddit ? `r/${escapeHtml(String(p.subreddit))}` : "—"}</div>
      <div><strong>Intensity</strong>${p.intensity ?? "—"}</div>
      <div><strong>Updated</strong>${escapeHtml(fmtTime(record.updatedAt))}</div>
    </div>
    ${
      p.threadUrl
        ? `<p class="muted"><a href="${escapeAttr(String(p.threadUrl))}" target="_blank" rel="noreferrer" style="color:inherit">${escapeHtml(String(p.threadTitle || p.threadUrl))}</a></p>`
        : ""
    }
    <div class="field">
      <label for="draftText">draftText</label>
      <textarea id="draftText">${escapeHtml(draftText)}</textarea>
    </div>
    <div class="actions">
      <button type="button" id="saveDraftBtn">Save draftText</button>
      <label style="text-transform:none;letter-spacing:0;color:var(--text)">
        Status
        <select id="statusSelect">
          <option value="">— transition —</option>
          ${nextStatuses.map((s) => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join("")}
        </select>
      </label>
      <button type="button" class="secondary" id="applyStatusBtn">Apply status</button>
    </div>
    <p id="detailMsg" class="muted"></p>
    <div class="field" style="margin-top:1.25rem">
      <label>Raw record</label>
      <pre class="raw">${escapeHtml(JSON.stringify(record, null, 2))}</pre>
    </div>
  `;

  const msg = document.getElementById("detailMsg");
  document.getElementById("saveDraftBtn").addEventListener("click", async () => {
    setMsg(msg, "Saving…");
    try {
      const value = document.getElementById("draftText").value;
      const { record: next } = await api(`/api/actions/${encodeURIComponent(record.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ field: "draftText", value }),
      });
      setMsg(msg, "Saved.", "ok");
      await loadList();
      renderActionDetail(next);
    } catch (err) {
      setMsg(msg, err.message, "error");
    }
  });

  document.getElementById("applyStatusBtn").addEventListener("click", async () => {
    const status = document.getElementById("statusSelect").value;
    if (!status) {
      setMsg(msg, "Pick a status first.", "error");
      return;
    }
    setMsg(msg, "Updating status…");
    try {
      const { record: next } = await api(
        `/api/actions/${encodeURIComponent(record.id)}/status`,
        { method: "POST", body: JSON.stringify({ status }) }
      );
      setMsg(msg, `Status → ${status}`, "ok");
      await loadList();
      renderActionDetail(next);
    } catch (err) {
      setMsg(msg, err.message, "error");
    }
  });

  document.getElementById("deleteBtn").addEventListener("click", async () => {
    if (!confirm(`Delete ${record.id}?`)) return;
    try {
      await api(`/api/actions/${encodeURIComponent(record.id)}`, { method: "DELETE" });
      selectedId = null;
      detailPane.innerHTML = `<p class="ok">Deleted ${escapeHtml(record.id)}</p>`;
      await loadList();
    } catch (err) {
      setMsg(msg, err.message, "error");
    }
  });
}

function renderAllowlistDetail(entry) {
  detailPane.innerHTML = `
    <div class="detail-head">
      <div>
        <h2>r/${escapeHtml(entry.name)}</h2>
        <p class="muted">${escapeHtml(entry.source)} · updated ${escapeHtml(fmtTime(entry.updatedAt))}</p>
      </div>
      <div class="actions">
        <button type="button" id="promoteBtn">Promote</button>
        <button type="button" class="secondary" id="rejectBtn">Reject</button>
      </div>
    </div>
    <div class="meta-grid">
      <div><strong>Status</strong><span class="badge ${escapeAttr(entry.status)}">${escapeHtml(entry.status)}</span></div>
      <div><strong>Score</strong>${escapeHtml(String(entry.score))}</div>
      <div><strong>rulesOk</strong>${entry.rulesOk ? "yes" : "no"}</div>
      <div><strong>Outcomes</strong>ok ${entry.approvedCount} / abort ${entry.abortedCount}</div>
    </div>
    <div class="field">
      <label for="note">note</label>
      <textarea id="note">${escapeHtml(entry.note || "")}</textarea>
    </div>
    <div class="field">
      <label for="score">score</label>
      <input id="score" type="number" value="${escapeAttr(String(entry.score))}" />
    </div>
    <div class="field">
      <label style="text-transform:none;letter-spacing:0;color:var(--text)">
        <input id="rulesOk" type="checkbox" ${entry.rulesOk ? "checked" : ""} />
        rulesOk
      </label>
    </div>
    <div class="field">
      <label for="alStatus">status</label>
      <select id="alStatus">
        ${allowlistStatuses
          .map(
            (s) =>
              `<option value="${escapeAttr(s)}" ${s === entry.status ? "selected" : ""}>${escapeHtml(s)}</option>`
          )
          .join("")}
      </select>
    </div>
    <div class="actions">
      <button type="button" id="saveAllowBtn">Save</button>
    </div>
    <p id="detailMsg" class="muted"></p>
    <div class="field" style="margin-top:1.25rem">
      <label>Raw entry</label>
      <pre class="raw">${escapeHtml(JSON.stringify(entry, null, 2))}</pre>
    </div>
  `;

  const msg = document.getElementById("detailMsg");
  const name = entry.name;

  document.getElementById("saveAllowBtn").addEventListener("click", async () => {
    setMsg(msg, "Saving…");
    try {
      const { entry: next } = await api(`/api/allowlist/${encodeURIComponent(name)}`, {
        method: "PATCH",
        body: JSON.stringify({
          note: document.getElementById("note").value,
          score: Number(document.getElementById("score").value),
          rulesOk: document.getElementById("rulesOk").checked,
          status: document.getElementById("alStatus").value,
        }),
      });
      setMsg(msg, "Saved.", "ok");
      await loadList();
      renderAllowlistDetail(next);
    } catch (err) {
      setMsg(msg, err.message, "error");
    }
  });

  document.getElementById("promoteBtn").addEventListener("click", async () => {
    setMsg(msg, "Promoting…");
    try {
      const { entry: next } = await api(
        `/api/allowlist/${encodeURIComponent(name)}/promote`,
        { method: "POST", body: "{}" }
      );
      setMsg(msg, "Promoted to postable.", "ok");
      await loadList();
      renderAllowlistDetail(next);
    } catch (err) {
      setMsg(msg, err.message, "error");
    }
  });

  document.getElementById("rejectBtn").addEventListener("click", async () => {
    if (!confirm(`Reject r/${name}?`)) return;
    setMsg(msg, "Rejecting…");
    try {
      const { entry: next } = await api(
        `/api/allowlist/${encodeURIComponent(name)}/reject`,
        { method: "POST", body: "{}" }
      );
      setMsg(msg, "Rejected.", "ok");
      await loadList();
      renderAllowlistDetail(next);
    } catch (err) {
      setMsg(msg, err.message, "error");
    }
  });
}

function renderFileDetail(kind, file, record, onDelete) {
  const title =
    kind === "Job"
      ? record?.jobId || file
      : record?.runId || file;

  detailPane.innerHTML = `
    <div class="detail-head">
      <div>
        <h2>${escapeHtml(String(title))}</h2>
        <p class="muted">${escapeHtml(file)} · read-only${kind === "Job" || kind === "Run" ? " (delete allowed)" : ""}</p>
      </div>
      <div class="actions">
        <button type="button" class="danger" id="deleteBtn">Delete</button>
      </div>
    </div>
    <p id="detailMsg" class="muted"></p>
    <div class="field">
      <label>Raw ${escapeHtml(kind.toLowerCase())}</label>
      <pre class="raw" style="max-height:70vh">${escapeHtml(JSON.stringify(record, null, 2))}</pre>
    </div>
  `;

  const msg = document.getElementById("detailMsg");
  document.getElementById("deleteBtn").addEventListener("click", async () => {
    if (!confirm(`Delete ${file}?`)) return;
    try {
      await onDelete();
      selectedId = null;
      detailPane.innerHTML = `<p class="ok">Deleted ${escapeHtml(file)}</p>`;
      await loadList();
    } catch (err) {
      setMsg(msg, err.message, "error");
    }
  });
}

async function init() {
  const meta = await api("/api/meta");
  actionStatuses = meta.statuses ?? [];
  allowlistStatuses = meta.allowlistStatuses ?? [];
  paths = {
    dataDir: meta.dataDir,
    storePath: meta.storePath,
    allowlistPath: meta.allowlistPath,
    jobsDir: meta.jobsDir,
    runsDir: meta.runsDir,
  };
  storePathEl.textContent = `Data: ${meta.dataDir}`;
  fillStatusOptions(actionStatuses);
  renderNav();
  refreshBtn.addEventListener("click", () => loadList());
  statusFilter.addEventListener("change", () => loadList());
  limitFilter.addEventListener("change", () => loadList());
  await loadList();
}

init().catch((err) => {
  storePathEl.textContent = err.message;
  storePathEl.classList.add("error");
});
