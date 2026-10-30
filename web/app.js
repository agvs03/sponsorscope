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

const PAGE = 150;

let JOBS = [];
let USING_SAMPLE = false;
let META = null;      // feed run stats: latest_day marks "new"
let SKILLS = [];      // [name, RegExp] — same vocabulary the feed builder tags jobs with
let shown = PAGE;

/* ----------------------------- boot + nav ------------------------------ */
async function boot() {
  [JOBS, META, SKILLS] = await Promise.all([loadJobs(), getJson("data/meta.json"), loadSkills()]);
  if (USING_SAMPLE) $("#demoBanner").hidden = false;
  if (META) {
    const d = new Date(META.generated_at);
    $("#feedMeta").textContent = `${META.jobs.toLocaleString()} open roles at ${META.companies} sponsoring employers · ` +
      `${META.new_today.toLocaleString()} new · updated ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  }
  setupTabs();
  setupSettings();
  setupResume();
  setupJobs();
  renderTracker();
  renderJobs();
}

/* ------------------------------ AI settings ---------------------------- */
function setupSettings() {
  const modal = $("#settings");
  const open = () => {
    $("#aiKey").value = window.SponsorPilotAI?.getKey() || "";
    $("#aiModel").value = window.SponsorPilotAI?.getModel() || "claude-opus-5-5";
    modal.hidden = false;
  };
  const close = () => (modal.hidden = true);
  $("#settingsBtn").addEventListener("click", open);
  $("#settingsClose").addEventListener("click", close);
  $("#settingsScrim").addEventListener("click", close);
  $("#aiSave").addEventListener("click", () => {
    window.SponsorPilotAI.setKey($("#aiKey").value);
    window.SponsorPilotAI.setModel($("#aiModel").value);
    const n = $("#aiSaved"); n.textContent = "✓ Saved"; setTimeout(() => (n.textContent = ""), 2000);
  });
  $("#aiClear").addEventListener("click", () => {
    window.SponsorPilotAI.setKey("");
    $("#aiKey").value = "";
    const n = $("#aiSaved"); n.textContent = "removed"; setTimeout(() => (n.textContent = ""), 2000);
  });
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
async function getJson(url) {
  try { const r = await fetch(url, { cache: "no-cache" }); return r.ok ? await r.json() : null; } catch { return null; }
}
async function loadSkills() {
  return ((await getJson("data/skills.json")) || []).map(([name, pat, cs]) => [name, new RegExp(pat, cs ? "" : "i")]);
}

/* ---------------------------- resume upload ---------------------------- */
// Parsed entirely in the browser; the file never leaves the device. PDF and
// Word readers load from cdnjs on first use only.
const loadScript = (src) => new Promise((ok, fail) => {
  if ([...document.scripts].some((s) => s.src === src)) return ok();
  const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => fail(new Error("could not load " + src));
  document.head.appendChild(s);
});
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
const MAMMOTH = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js";

async function fileText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) {
    await loadScript(PDFJS + "pdf.min.js");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js";
    const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const c = await (await pdf.getPage(i)).getTextContent();
      pages.push(c.items.map((it) => it.str + (it.hasEOL ? "\n" : " ")).join(""));
    }
    return pages.join("\n");
  }
  if (name.endsWith(".docx")) {
    await loadScript(MAMMOTH);
    return (await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
  }
  return file.text();
}

async function importResume(file) {
  const note = $("#uploadNote");
  note.textContent = "Reading " + file.name + "…";
  try {
    const text = await fileText(file);
    const found = SKILLS.filter(([, re]) => re.test(text)).map(([n]) => n);
    const form = $("#resumeForm");
    const have = skillList(form.elements.skills.value);
    const merged = [...have, ...found.filter((s) => !have.some((h) => h.toLowerCase() === s.toLowerCase()))];
    form.elements.skills.value = merged.join(", ");
    const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
    const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    const phone = text.match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
    if (!form.elements.email.value && email) form.elements.email.value = email[0];
    if (!form.elements.phone.value && phone) form.elements.phone.value = phone[0].trim();
    if (!form.elements.name.value && lines[0] && lines[0].length < 60 && !/@|\d/.test(lines[0])) form.elements.name.value = lines[0];
    collectResume(); renderPreview();
    note.textContent = found.length
      ? `✓ Found ${found.length} skills — jobs are now ranked by your fit. Review your details below.`
      : "Read the file but found no skills we recognize — add them in the Skills box.";
    renderJobs();
  } catch (e) {
    note.textContent = "Couldn't read that file (" + e.message + "). Try a .docx or .txt copy.";
  }
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
  $("#resumeFile").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) importResume(f); e.target.value = ""; });
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
  const reset = () => { shown = PAGE; renderJobs(); };
  ["#q", "#loc"].forEach((sel) => $(sel).addEventListener("input", reset));
  ["#sponsorsOnly", "#hideNoSponsor", "#newOnly", "#sortBy"].forEach((sel) => $(sel).addEventListener("change", reset));
}
const isNew = (j) => META && j.first_seen === META.latest_day;
const blocked = (j) => j.flags && (j.flags.no_sponsor || j.flags.citizenship || j.flags.clearance);
const fmtDate = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");

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
  if (s.tier) return ({ strong: 0.7, moderate: 0.45 }[s.tier] ?? 0.2) + Math.min(0.3, Math.log10((s.filings || 0) + 1) / 12);
  const t = { up: 1, flat: 0.6, down: 0.25 }[s.trend] ?? 0.5;
  return (s.approval_rate ?? 0.8) * 0.6 + t * 0.4;
}

function renderJobs() {
  const q = $("#q").value.trim().toLowerCase();
  const loc = $("#loc").value.trim().toLowerCase();
  const sponsorsOnly = $("#sponsorsOnly").checked;
  const hideNo = $("#hideNoSponsor").checked;
  const newOnly = $("#newOnly").checked;
  const sortBy = $("#sortBy").value;
  const hasResume = skillList(getResume().skills).length > 0;

  let list = JOBS.filter((j) => {
    if (sponsorsOnly && !(j.sponsorship && j.sponsorship.sponsors)) return false;
    if (hideNo && blocked(j)) return false;
    if (newOnly && !isNew(j)) return false;
    if (q && !(`${j.title} ${j.company} ${(j.skills || []).join(" ")}`.toLowerCase().includes(q))) return false;
    if (loc && !(`${j.location} ${j.remote ? "remote" : ""}`.toLowerCase().includes(loc))) return false;
    return true;
  });

  const newest = (a, b) => (b.j.posted || b.j.first_seen || "").localeCompare(a.j.posted || a.j.first_seen || "");
  const order = {
    fit: (a, b) => (hasResume ? (b.f.score ?? -1) - (a.f.score ?? -1) : 0) || newest(a, b) || b.s - a.s,
    new: (a, b) => newest(a, b) || b.s - a.s,
    sponsor: (a, b) => b.s - a.s || newest(a, b),
  }[sortBy];
  list = list.map((j) => ({ j, f: fit(j), s: sponsorScore(j) })).sort(order);

  $("#jobsMeta").textContent = `${list.length.toLocaleString()} job${list.length === 1 ? "" : "s"}` +
    (sponsorsOnly ? " at employers with sponsorship history" : "") +
    (hasResume ? (sortBy === "fit" ? " · ranked by fit to your resume" : "") : " · upload your resume (Resume Builder tab) to see your fit");

  const box = $("#jobList");
  if (!list.length) { box.innerHTML = `<p class="empty">No matching jobs. Try a broader keyword or turn off a filter.</p>`; return; }
  box.innerHTML = list.slice(0, shown).map(({ j, f }) => {
    const sp = j.sponsorship;
    const warn = blocked(j);
    return `<div class="job${warn ? " warned" : ""}" data-id="${esc(j.id)}">
      <div class="top">
        <div><div class="title">${isNew(j) ? `<span class="badge new">new</span> ` : ""}${esc(j.title)}</div>
          <div class="co">${esc(j.company)} · ${esc(j.location)}${j.remote && !/remote/i.test(j.location) ? " · Remote" : ""}</div></div>
        ${sp && sp.sponsors ? sponsorBadge(sp) : `<span class="badge no">no sponsor record</span>`}
      </div>
      <div class="sub">
        ${f.score != null ? `<span class="match">${f.score}% fit</span>` : ""}
        ${j.posted ? `<span>Posted ${fmtDate(j.posted)}</span>` : j.first_seen ? `<span>Seen ${fmtDate(j.first_seen)}</span>` : ""}
        ${sp && sp.filings ? `<span>${sp.filings.toLocaleString()} H-1B filings</span>` : ""}
        ${sp && sp.median_wage ? `<span>~${usd(sp.median_wage)}/yr typical</span>` : ""}
        ${sp && sp.approval_rate != null ? `<span>${Math.round(sp.approval_rate * 100)}% USCIS approval</span>` : ""}
        ${warn ? `<span class="warn">⚠ ${j.flags.no_sponsor ? "posting says no sponsorship" : j.flags.citizenship ? "US citizenship required" : "security clearance"}</span>` : ""}
      </div></div>`;
  }).join("") + (list.length > shown ? `<button class="ghost more" id="showMore">Show ${Math.min(PAGE, list.length - shown)} more of ${(list.length - shown).toLocaleString()}</button>` : "");
  $$(".job", box).forEach((el) => el.addEventListener("click", () => openDrawer(el.dataset.id)));
  const more = $("#showMore");
  if (more) more.onclick = () => { shown += PAGE; renderJobs(); };
}
function sponsorBadge(sp) {
  if (sp.tier) {
    const label = { strong: "● strong sponsor", moderate: "◐ sponsors" }[sp.tier] || "some sponsorship";
    return `<span class="badge ${sp.tier === "strong" ? "up" : "flat"}">${label}</span>`;
  }
  const label = { up: "▲ sponsoring — rising", down: "▼ sponsoring — declining", flat: "▬ sponsoring — steady" }[sp.trend] || "sponsors";
  return `<span class="badge ${sp.trend}">${label}</span>`;
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
    <div class="co">${esc(j.company)} · ${esc(j.location)}${j.remote && !/remote/i.test(j.location) ? " · Remote" : ""}</div>
    <div class="co">${[j.posted && "Posted " + fmtDate(j.posted), j.first_seen && "first seen here " + fmtDate(j.first_seen)].filter(Boolean).join(" · ")}</div>
    ${blocked(j) ? `<div class="warn-box">⚠ This posting's own text says:
      <q>${esc(j.flags.no_sponsor || j.flags.citizenship || j.flags.clearance)}</q>
      ${j.flags.no_sponsor ? "Even though this employer sponsors for other roles, this one may not." : ""}</div>` : ""}
    <div class="stats">
      <div class="stat"><div class="k">Your fit</div><div class="v">${f.score != null ? f.score + "%" : "—"}</div></div>
      <div class="stat"><div class="k">Sponsors?</div><div class="v">${sp.sponsors ? "Yes" : "No record"}</div></div>
      <div class="stat"><div class="k">USCIS approval</div><div class="v">${sp.approval_rate != null ? Math.round(sp.approval_rate * 100) + "%" : "—"}</div></div>
      <div class="stat"><div class="k">Typical wage</div><div class="v">${usd(sp.median_wage) || "—"}</div></div>
    </div>
    ${sp.filings ? `<p class="meta">DOL record: ${sp.filings.toLocaleString()} H-1B filings${sp.green_cards ? ` · ${sp.green_cards.toLocaleString()} green-card (PERM) filings` : ""}${sp.years ? ` · ${esc(sp.years)}` : ""}.</p>` : ""}
    ${j.description ? `<h4>About the role</h4><p>${esc(j.description)}${j.description.length >= 400 ? "…" : ""}</p>` : ""}
    <h4>Skills match</h4>
    <p>${f.have.length ? `<span class="have">✓ ${f.have.map(esc).join(", ")}</span>` : ""}
       ${f.miss.length ? `<br><span class="miss">▲ Consider adding: ${f.miss.map(esc).join(", ")}</span>` : ""}
       ${f.score == null ? "Add skills to your resume to see your fit." : ""}</p>
    <h4>Draft application note <small>(edit before sending — you send it, we don't)</small></h4>
    <div class="draft" id="draftText">${esc(draftNote(r, j, f))}</div>
    <div class="row-actions" style="margin-top:8px">
      <button class="ghost" id="aiTailor">✨ Tailor with AI</button>
      <button class="ghost" id="aiExplain">✨ Explain my fit</button>
    </div>
    <div id="aiOut" class="ai-out" hidden></div>
    <div class="row-actions">
      <button class="primary" id="copyDraft">Copy draft</button>
      <a class="ghost link-btn" href="${esc(j.url || "#")}" target="_blank" rel="noopener">Open application ↗</a>
      <button class="ghost" id="saveJob">${isTracked(j.id) ? "✓ Saved" : "Save to tracker"}</button>
    </div>`;
  $("#drawer").hidden = false;
  $("#closeDrawer").onclick = $("#drawerScrim").onclick = closeDrawer;
  $("#copyDraft").onclick = () => navigator.clipboard?.writeText($("#draftText").textContent);
  $("#saveJob").onclick = () => { track(j); openDrawer(id); renderTracker(); };

  const aiOut = $("#aiOut");
  const aiReady = () => {
    if (window.SponsorPilotAI?.hasKey()) return true;
    aiOut.hidden = false;
    aiOut.textContent = "Add your Anthropic API key in the ⚙ AI menu (top right) to enable AI features.";
    return false;
  };
  $("#aiTailor").onclick = async () => {
    if (!aiReady()) return;
    aiOut.hidden = false; aiOut.textContent = "Tailoring your note with Claude…";
    try {
      const text = await window.SponsorPilotAI.tailorDraft({ resume: r, job: j, fit: f });
      $("#draftText").textContent = text;
      aiOut.textContent = "✓ Draft rewritten by Claude — review and edit before sending.";
    } catch (e) { aiOut.textContent = "AI error: " + e.message; }
  };
  $("#aiExplain").onclick = async () => {
    if (!aiReady()) return;
    aiOut.hidden = false; aiOut.textContent = "Analyzing your fit with Claude…";
    try {
      aiOut.textContent = await window.SponsorPilotAI.explainFit({ resume: r, job: j, fit: f });
    } catch (e) { aiOut.textContent = "AI error: " + e.message; }
  };
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
