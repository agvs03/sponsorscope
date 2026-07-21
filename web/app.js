/* SponsorScope — static frontend.
 * Loads pre-built JSON (produced by the pipeline) and renders employer
 * sponsorship profiles entirely client-side. No backend required.
 * Falls back to the committed sample data when a real build isn't present. */

const $ = (sel) => document.querySelector(sel);
const fmtInt = (n) => (n == null ? "—" : n.toLocaleString());
const fmtUSD = (n) => (n == null ? "—" : "$" + Math.round(n).toLocaleString());

let INDEX = [];
let EMPLOYERS = {};
let USING_SAMPLE = false;

/** Try the real build first, fall back to the committed sample. */
async function loadJSON(primary, fallback) {
  try {
    const r = await fetch(primary, { cache: "no-cache" });
    if (r.ok) return await r.json();
  } catch (_) { /* fall through to sample */ }
  try {
    const r = await fetch(fallback, { cache: "no-cache" });
    if (r.ok) { USING_SAMPLE = true; return await r.json(); }
  } catch (_) { /* none available */ }
  return null;
}

async function boot() {
  INDEX = (await loadJSON("data/index.json", "data/sample.index.json")) || [];
  EMPLOYERS = (await loadJSON("data/employers.json", "data/sample.employers.json")) || {};
  $("#meta").textContent = INDEX.length
    ? `${INDEX.length.toLocaleString()} employers with sponsorship history on file.`
    : "No data loaded — run the pipeline (see README).";
  if (USING_SAMPLE) $("#demoBanner").hidden = false;
  loadDataNote();
  render("");
  $("#q").addEventListener("input", (e) => { $("#profile").hidden = true; render(e.target.value); });
}

async function loadDataNote() {
  // config.yaml value is baked into the page at build time if present; else a default.
  $("#dataNote").textContent =
    "Built from public DOL OFLC LCA and USCIS H-1B Employer Data Hub disclosures. Data lags ~1 quarter.";
}

function trendBadge(trend) {
  const label = { up: "▲ rising", down: "▼ declining", flat: "▬ steady" }[trend] || trend;
  return `<span class="badge ${trend}">${label}</span>`;
}

function render(query) {
  const q = query.trim().toLowerCase();
  const results = $("#results");
  const matches = (q
    ? INDEX.filter((e) => e.name.toLowerCase().includes(q))
    : INDEX
  ).slice(0, 50);

  if (!matches.length) {
    results.innerHTML = `<p class="empty">No employer matches "${query}".</p>`;
    return;
  }
  results.innerHTML = matches.map((e) => `
    <button class="row" data-slug="${e.slug}">
      <span>
        <span class="name">${escapeHtml(e.name)}</span><br>
        <span class="sub">${fmtInt(e.total)} filings · ${e.certified_pct}% certified</span>
      </span>
      ${trendBadge(e.trend)}
    </button>`).join("");

  results.querySelectorAll(".row").forEach((btn) =>
    btn.addEventListener("click", () => showProfile(btn.dataset.slug)));
}

function showProfile(slug) {
  const p = EMPLOYERS[slug];
  if (!p) return;
  const w = p.wages || {};
  const u = p.uscis;
  const el = $("#profile");
  el.innerHTML = `
    <div class="card">
      <button class="back" id="back">← back to results</button>
      <h2>${escapeHtml(p.name)} ${trendBadge(p.lca.trend)}</h2>
      <div class="stats">
        <div class="stat"><div class="k">LCA filings</div><div class="v">${fmtInt(p.lca.total)}</div></div>
        <div class="stat"><div class="k">Certified</div><div class="v">${p.lca.certified_pct}%</div></div>
        <div class="stat"><div class="k">USCIS approval rate</div><div class="v">${u && u.approval_rate != null ? Math.round(u.approval_rate * 100) + "%" : "—"}</div></div>
        <div class="stat"><div class="k">Median offered wage</div><div class="v">${fmtUSD(w.median_annual)} <small>/yr</small></div></div>
      </div>

      <h3 class="section">Salary range (offered wages, certified filings)</h3>
      <p>${fmtUSD(w.p25_annual)} — ${fmtUSD(w.p75_annual)} <span class="sub">(25th–75th percentile)</span></p>

      <h3 class="section">Top sponsored roles</h3>
      <div class="chips">${(p.top_titles || []).map((t) => `<span class="chip">${escapeHtml(t.title)} · ${t.count}</span>`).join("") || "—"}</div>

      <h3 class="section">Top worksite states</h3>
      <div class="chips">${(p.top_states || []).map((s) => `<span class="chip">${escapeHtml(s.state)} · ${s.count}</span>`).join("") || "—"}</div>
    </div>`;
  el.hidden = false;
  $("#back").addEventListener("click", () => { el.hidden = true; window.scrollTo(0, 0); });
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

boot();
