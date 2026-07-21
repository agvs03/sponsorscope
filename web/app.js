/* SponsorPilot — end-to-end job hunting, client-side.
 * Resume + tracker live in localStorage (private to the browser). Jobs load
 * from the pipeline's JSON (falls back to committed sample data with a banner).
 * No backend, no login, no per-user cost. AI drafting is a v2 upgrade; the
 * draft here is a transparent template, and fit is keyword overlap (a guide). */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const usd = (n) => (n == null ? null : "$" + Math.round(n / 1000) + "k");
const RESUME_KEY = "sponsorpilot.resume";
const TRACKER_KEY = "sponsorpilot.tracker";

let JOBS = [];
let USING_SAMPLE = false;

/* ----------------------------- boot + nav ------------------------------ */
async function boot() {
  JOBS = await loadJobs();
  if (USING_SAMPLE) $("#demoBanner").hidden = false;
  setupTabs();
  setupResume();
  setupJobs();
  renderTracker();
  renderJobs();
}

function setupTabs() {
  $$("#tabs .tab").forEach((t) =>
    t.addEventListener("click", () => showView(t.dataset.view)));
}
function showView(view) {
  $$(".view").forEach((v) => (v.hidden = true));
  $("#view-" + view).hidden = false;
  $$("#tabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  if (view === "jobs") renderJobs();
  if (view === "resume") renderPreview();
  if (view === "tracker") renderTracker();
}

async function loadJobs() {
  for (const [url, sample] of [["data/jobs.json", false], ["data/sample.jobs.json", true]]) {
    try {
      const r = await fetch(url, { cache: "no-cache" });
      if (r.ok) { USING_SAMPLE = sample; return await r.json(); }
    } catch (_) { /* next */ }
  }
  return [];
}

/* ------------------------------- resume -------------------------------- */
function getResume() {
  try { return JSON.parse(localStorage.getItem(RESUME_KEY)) || blankResume(); }
  catch { return blankResume(); }
}
function blankResume() {
  return { name: "", email: "", phone: "", location: "", linkedin: "", summary: "", skills: "", experience: [], education: [] };
}
function saveResume(r) { localStorage.setItem(RESUME_KEY, JSON.stringify(r)); }

function setupResume() {
  const r = getResume();
  const form = $("#resumeForm");
  ["name", "email", "phone", "location", "linkedin", "summary", "skills"].forEach((k) => {
    if (form.elements[k]) form.elements[k].value = r[k] || "";
  });
  (r.experience.length ? r.experience : [{}]).forEach(addExpRow);
  (r.education.length ? r.education : [{}]).forEach(addEduRow);

  form.addEventListener("input", () => { collectResume(); renderPreview(); });
  $("#addExp").addEventListener("click", () => addExpRow({}));
  $("#addEdu").addEventListener("click", () => addEduRow({}));
  $("#saveResume").addEventListener("click", () => {
    saveResume(collectResume());
    const n = $("#resumeSaved"); n.textContent = "✓ Saved to this browser"; setTimeout(() => (n.textContent = ""), 2500);
    renderJobs();
  });
  $("#printResume").addEventListener("click", () => window.print());
  renderPreview();
}

function addExpRow(e) {
  const div = document.createElement("div");
  div.className = "exp";
  div.innerHTML = `<button type="button" class="remove">remove</button>
    <div class="field-row"><label>Title<input data-f="title" value="${esc(e.title)}"></label>
      <label>Company<input data-f="company" value="${esc(e.company)}"></label></div>
    <div class="field-row"><label>Start<input data-f="start" value="${esc(e.start)}" placeholder="2022"></label>
      <label>End<input data-f="end" value="${esc(e.end)}" placeholder="Present"></label></div>
    <label>Highlights <small>(one per line)</small><textarea data-f="bullets" rows="3">${esc((e.bullets || []).join("\n"))}</textarea></label>`;
  div.querySelector(".remove").addEventListener("click", () => { div.remove(); collectResume(); renderPreview(); });
  $("#expList").appendChild(div);
}
function addEduRow(e) {
  const div = document.createElement("div");
  div.className = "edu";
  div.innerHTML = `<button type="button" class="remove">remove</button>
    <div class="field-row"><label>School<input data-f="school" value="${esc(e.school)}"></label>
      <label>Degree<input data-f="degree" value="${esc(e.degree)}"></label>
      <label>Year<input data-f="year" value="${esc(e.year)}" placeholder="2024"></label></div>`;
  div.querySelector(".remove").addEventListener("click", () => { div.remove(); collectResume(); renderPreview(); });
  $("#eduList").appendChild(div);
}

function collectResume() {
  const form = $("#resumeForm");
  const r = blankResume();
  ["name", "email", "phone", "location", "linkedin", "summary", "skills"].forEach((k) => (r[k] = form.elements[k]?.value || ""));
  r.experience = $$("#expList .exp").map((d) => ({
    title: val(d, "title"), company: val(d, "company"), start: val(d, "start"), end: val(d, "end"),
    bullets: val(d, "bullets").split("\n").map((s) => s.trim()).filter(Boolean),
  }));
  r.education = $$("#eduList .edu").map((d) => ({ school: val(d, "school"), degree: val(d, "degree"), year: val(d, "year") }));
  saveResume(r);
  return r;
}
const val = (row, f) => row.querySelector(`[data-f="${f}"]`)?.value.trim() || "";

function renderPreview() {
  const r = getResume();
  const skills = skillList(r.skills);
  $("#resumePreview").innerHTML = `
    <h2>${esc(r.name) || "Your Name"}</h2>
    <div class="contact">${[r.email, r.phone, r.location, r.linkedin].filter(Boolean).map(esc).join(" · ") || "email · phone · location"}</div>
    ${r.summary ? `<p>${esc(r.summary)}</p>` : ""}
    ${skills.length ? `<h4>Skills</h4><div class="chips">${skills.map((s) => `<span class="chip">${esc(s)}</span>`).join("")}</div>` : ""}
    ${r.experience.some((e) => e.title || e.company) ? `<h4>Experience</h4>${r.experience.map((e) => `
      <div class="entry"><div class="h">${esc(e.title) || "Role"}${e.company ? " — " + esc(e.company) : ""}</div>
      <div class="m">${[e.start, e.end].filter(Boolean).map(esc).join(" – ")}</div>
      ${e.bullets?.length ? `<ul>${e.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}</div>`).join("")}` : ""}
    ${r.education.some((e) => e.school) ? `<h4>Education</h4>${r.education.map((e) => `
      <div class="entry"><div class="h">${esc(e.degree) || "Degree"}${e.school ? ", " + esc(e.school) : ""}</div>
      <div class="m">${esc(e.year)}</div></div>`).join("")}` : ""}`;
}
const skillList = (s) => (s || "").split(",").map((x) => x.trim()).filter(Boolean);

/* -------------------------------- jobs --------------------------------- */
function setupJobs() {
  ["#q", "#loc"].forEach((sel) => $(sel).addEventListener("input", renderJobs));
  $("#sponsorsOnly").addEventListener("change", renderJobs);
}

function fit(job) {
  const mine = new Set(skillList(getResume().skills).map((s) => s.toLowerCase()));
  const need = (job.skills || []).map((s) => s.toLowerCase());
  if (!mine.size || !need.length) return { score: null, have: [], miss: job.skills || [] };
  const have = need.filter((s) => mine.has(s));
  return {
    score: Math.round((100 * have.length) / need.length),
    have: (job.skills || []).filter((s) => mine.has(s.toLowerCase())),
    miss: (job.skills || []).filter((s) => !mine.has(s.toLowerCase())),
  };
}

function sponsorScore(j) {
  const s = j.sponsorship;
  if (!s || !s.sponsors) return 0;
  const t = { up: 1, flat: 0.6, down: 0.25 }[s.trend] ?? 0.5;
  return (s.approval_rate ?? 0.8) * 0.6 + t * 0.4;
}

function renderJobs() {
  const q = $("#q").value.trim().toLowerCase();
  const loc = $("#loc").value.trim().toLowerCase();
  const sponsorsOnly = $("#sponsorsOnly").checked;
  const hasResume = skillList(getResume().skills).length > 0;

  let list = JOBS.filter((j) => {
    if (sponsorsOnly && !(j.sponsorship && j.sponsorship.sponsors)) return false;
    if (q && !(`${j.title} ${j.company} ${(j.skills || []).join(" ")}`.toLowerCase().includes(q))) return false;
    if (loc && !(`${j.location} ${j.remote ? "remote" : ""}`.toLowerCase().includes(loc))) return false;
    return true;
  });

  list = list.map((j) => ({ j, f: fit(j), s: sponsorScore(j) }))
    .sort((a, b) => (hasResume ? (b.f.score ?? -1) - (a.f.score ?? -1) || b.s - a.s : b.s - a.s));

  $("#jobsMeta").textContent = `${list.length} job${list.length === 1 ? "" : "s"}` +
    (sponsorsOnly ? " at employers with sponsorship history" : "") +
    (hasResume ? " · ranked by fit to your resume" : " · add a resume to see your fit");

  const box = $("#jobList");
  if (!list.length) { box.innerHTML = `<p class="empty">No matching jobs. Try a broader keyword or turn off "Sponsors only".</p>`; return; }
  box.innerHTML = list.map(({ j, f }) => {
    const sp = j.sponsorship;
    return `<div class="job" data-id="${esc(j.id)}">
      <div class="top">
        <div><div class="title">${esc(j.title)}</div><div class="co">${esc(j.company)} · ${esc(j.location)}${j.remote ? " · Remote" : ""}</div></div>
        ${sp && sp.sponsors ? sponsorBadge(sp.trend) : `<span class="badge no">no sponsor history</span>`}
      </div>
      <div class="sub">
        ${f.score != null ? `<span class="match">${f.score}% fit</span>` : ""}
        ${sp && sp.median_wage ? `<span>~${usd(sp.median_wage)}/yr typical</span>` : ""}
        ${sp && sp.approval_rate != null ? `<span>${Math.round(sp.approval_rate * 100)}% USCIS approval</span>` : ""}
      </div></div>`;
  }).join("");
  $$(".job", box).forEach((el) => el.addEventListener("click", () => openDrawer(el.dataset.id)));
}
function sponsorBadge(trend) {
  const label = { up: "▲ sponsoring — rising", down: "▼ sponsoring — declining", flat: "▬ sponsoring — steady" }[trend] || "sponsors";
  return `<span class="badge ${trend}">${label}</span>`;
}

/* ---------------------------- job detail ------------------------------- */
function openDrawer(id) {
  const j = JOBS.find((x) => x.id === id);
  if (!j) return;
  const f = fit(j), sp = j.sponsorship || {};
  const r = getResume();
  $("#drawerPanel").innerHTML = `
    <button class="close-x" id="closeDrawer">×</button>
    <h2>${esc(j.title)}</h2>
    <div class="co">${esc(j.company)} · ${esc(j.location)}${j.remote ? " · Remote" : ""}</div>
    <div class="stats">
      <div class="stat"><div class="k">Your fit</div><div class="v">${f.score != null ? f.score + "%" : "—"}</div></div>
      <div class="stat"><div class="k">Sponsors?</div><div class="v">${sp.sponsors ? "Yes" : "No record"}</div></div>
      <div class="stat"><div class="k">USCIS approval</div><div class="v">${sp.approval_rate != null ? Math.round(sp.approval_rate * 100) + "%" : "—"}</div></div>
      <div class="stat"><div class="k">Typical wage</div><div class="v">${usd(sp.median_wage) || "—"}</div></div>
    </div>
    ${j.description ? `<h4>About the role</h4><p>${esc(j.description)}</p>` : ""}
    <h4>Skills match</h4>
    <p>${f.have.length ? `<span class="have">✓ ${f.have.map(esc).join(", ")}</span>` : ""}
       ${f.miss.length ? `<br><span class="miss">▲ Consider adding: ${f.miss.map(esc).join(", ")}</span>` : ""}
       ${f.score == null ? "Add skills to your resume to see your fit." : ""}</p>
    <h4>Draft application note <small>(edit before sending — you send it, we don't)</small></h4>
    <div class="draft" id="draftText">${esc(draftNote(r, j, f))}</div>
    <div class="row-actions">
      <button class="primary" id="copyDraft">Copy draft</button>
      <a class="ghost link-btn" href="${esc(j.url || "#")}" target="_blank" rel="noopener">Open application ↗</a>
      <button class="ghost" id="saveJob">${isTracked(j.id) ? "✓ Saved" : "Save to tracker"}</button>
    </div>`;
  $("#drawer").hidden = false;
  $("#closeDrawer").onclick = $("#drawerScrim").onclick = closeDrawer;
  $("#copyDraft").onclick = () => navigator.clipboard?.writeText($("#draftText").textContent);
  $("#saveJob").onclick = () => { track(j); openDrawer(id); renderTracker(); };
}
function closeDrawer() { $("#drawer").hidden = true; }

function draftNote(r, j, f) {
  const name = r.name || "[Your name]";
  const strengths = (f.have.length ? f.have : (j.skills || [])).slice(0, 3).join(", ");
  const summary = r.summary ? ` ${r.summary}` : "";
  return `Hi ${j.company} hiring team,

I'm applying for the ${j.title} role.${summary} My experience with ${strengths || "the core requirements"} lines up closely with what the position calls for, and I'm excited about the work your team is doing.

I'd welcome the chance to discuss how I can contribute.

Best regards,
${name}`;
}

/* ------------------------------ tracker -------------------------------- */
function getTracker() { try { return JSON.parse(localStorage.getItem(TRACKER_KEY)) || []; } catch { return []; } }
function setTracker(t) { localStorage.setItem(TRACKER_KEY, JSON.stringify(t)); $("#trackerCount").textContent = t.length; }
function isTracked(id) { return getTracker().some((x) => x.id === id); }
function track(j) {
  const t = getTracker();
  if (!t.some((x) => x.id === j.id)) { t.push({ id: j.id, title: j.title, company: j.company, url: j.url, status: "Saved" }); setTracker(t); }
}
function renderTracker() {
  const t = getTracker();
  setTracker(t);
  const box = $("#trackerList");
  if (!t.length) { box.innerHTML = `<p class="empty">No saved jobs yet. Open a job and hit "Save to tracker".</p>`; return; }
  const statuses = ["Saved", "Applied", "Interviewing", "Offer", "Rejected"];
  box.innerHTML = t.map((x) => `<div class="job">
    <div class="top"><div><div class="title">${esc(x.title)}</div><div class="co">${esc(x.company)}</div></div>
      <button class="remove" data-rm="${esc(x.id)}">remove</button></div>
    <div class="sub">
      <select data-st="${esc(x.id)}">${statuses.map((s) => `<option ${s === x.status ? "selected" : ""}>${s}</option>`).join("")}</select>
      ${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">open ↗</a>` : ""}
    </div></div>`).join("");
  $$("[data-rm]", box).forEach((b) => b.onclick = () => { setTracker(getTracker().filter((y) => y.id !== b.dataset.rm)); renderTracker(); });
  $$("[data-st]", box).forEach((sel) => sel.onchange = () => {
    const t2 = getTracker(); const it = t2.find((y) => y.id === sel.dataset.st); if (it) it.status = sel.value; setTracker(t2);
  });
}

boot();
