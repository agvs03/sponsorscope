/* SponsorPilot accounts (optional). Signed-out visitors keep everything in
 * localStorage exactly as before; signing in syncs the parsed resume, tracker
 * and saved searches to Supabase so they follow the user across devices.
 * Inactive until web/config.js has a Supabase URL + anon key. */
(function () {
  const cfg = window.SPONSORPILOT_CONFIG || {};
  const enabled = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  const SDK = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let sb = null;
  let user = null;
  let resumeTimer = null;

  const api = {
    enabled,
    user: () => user,
    onResume(r) {
      if (!user) return;
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => sb.from("profiles").upsert({ id: user.id, resume: r, updated_at: new Date().toISOString() }), 1200);
    },
    async onTracker(list) {
      if (!user) return;
      const rows = list.map((x) => ({ user_id: user.id, job_id: x.id, title: x.title, company: x.company, url: x.url, status: x.status, updated_at: new Date().toISOString() }));
      if (rows.length) await sb.from("tracker").upsert(rows);
      const ids = list.map((x) => x.id);
      let del = sb.from("tracker").delete().eq("user_id", user.id);
      if (ids.length) del = del.not("job_id", "in", `(${ids.map((i) => `"${i.replace(/"/g, "")}"`).join(",")})`);
      await del;
    },
    async saveSearch(f) {
      if (!user) { open(); note("Sign in to get daily emails for this search."); return false; }
      const { error } = await sb.from("saved_searches").insert({ user_id: user.id, query: f.q, location: f.loc, sponsors_only: f.sponsorsOnly, hide_no_sponsor: f.hideNo });
      if (error) { alert("Couldn't save the alert: " + error.message); return false; }
      return true;
    },
  };
  window.SponsorPilotAccount = api;
  if (!enabled) return;

  const loadSdk = () => new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = SDK; s.onload = ok; s.onerror = () => fail(new Error("could not load sign-in library"));
    document.head.appendChild(s);
  });

  /* ------------------------------ sync -------------------------------- */
  async function pull() {
    const app = window.SponsorPilotApp;
    const [{ data: prof }, { data: rows }] = await Promise.all([
      sb.from("profiles").select("resume").eq("id", user.id).maybeSingle(),
      sb.from("tracker").select("*").eq("user_id", user.id),
    ]);
    // Resume: the account copy wins when it has content; otherwise this
    // browser's copy becomes the account copy (first sign-in).
    const local = app.getResume();
    const remote = prof?.resume;
    const hasContent = (r) => r && (r.name || r.skills || (r.experience || []).length);
    if (hasContent(remote)) app.setResume(remote);
    else if (hasContent(local)) await sb.from("profiles").upsert({ id: user.id, resume: local, updated_at: new Date().toISOString() });
    // Tracker: union of both, account status wins on the same job.
    const merged = new Map(app.getTracker().map((x) => [x.id, x]));
    for (const r of rows || []) merged.set(r.job_id, { id: r.job_id, title: r.title, company: r.company, url: r.url, status: r.status });
    app.setTrackerList([...merged.values()]);
    app.refresh();
  }

  /* ------------------------------- UI --------------------------------- */
  function note(msg) { const n = $("#acctNote"); if (n) n.textContent = msg; }
  function open() { $("#account").hidden = false; render(); }
  function close() { $("#account").hidden = true; }

  async function render() {
    const body = $("#acctBody");
    $("#acctBtn").textContent = user ? "👤 Account" : "Sign in";
    if (!user) {
      body.innerHTML = `
        <h2>Sign in</h2>
        <p class="meta">Save your resume, tracker and job alerts to an account so they follow you to any device.
          Browsing jobs never needs an account.</p>
        <button class="primary wide" id="acctGoogle">Continue with Google</button>
        <div class="or">or</div>
        <label>Email <input id="acctEmail" type="email" placeholder="you@email.com" autocomplete="email"></label>
        <button class="ghost wide" id="acctLink">Email me a sign-in link</button>
        <p id="acctNote" class="saved-note"></p>
        <p class="meta">By signing in you agree to the <a href="privacy.html">privacy notice</a>. We store your parsed resume
          details (not the file), saved jobs and alerts — nothing else.</p>`;
      $("#acctGoogle").onclick = () => sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
      $("#acctLink").onclick = async () => {
        const email = $("#acctEmail").value.trim();
        if (!/^\S+@\S+\.\S+$/.test(email)) return note("Enter a valid email address.");
        note("Sending…");
        const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
        note(error ? "Couldn't send: " + error.message : "✓ Check your inbox for the sign-in link.");
      };
      return;
    }
    const { data: searches } = await sb.from("saved_searches").select("*").eq("user_id", user.id).order("created_at");
    body.innerHTML = `
      <h2>Your account</h2>
      <p class="meta">Signed in as <strong>${esc(user.email)}</strong>. Your resume and tracker sync automatically.</p>
      <h4>Daily job alerts</h4>
      ${(searches || []).length ? `<div class="alerts">${searches.map((s) => `
        <div class="alert-row">
          <div><strong>${esc(s.query || "Any role")}</strong>${s.location ? " · " + esc(s.location) : ""}
            <div class="meta">${s.sponsors_only ? "sponsors only" : "all employers"}${s.hide_no_sponsor ? " · hides “no sponsorship”" : ""}</div></div>
          <label class="toggle"><input type="checkbox" data-email="${s.id}" ${s.email_enabled ? "checked" : ""}> email</label>
          <button class="remove" data-del="${s.id}">delete</button>
        </div>`).join("")}</div>`
        : `<p class="meta">No alerts yet. On Find Jobs, set a keyword/location and press <strong>🔔 Alert me</strong>.</p>`}
      <div class="row-actions">
        <button class="ghost" id="acctOut">Sign out</button>
        <button class="ghost danger" id="acctDelete">Delete my account</button>
      </div>
      <p id="acctNote" class="saved-note"></p>`;
    body.querySelectorAll("[data-email]").forEach((c) => (c.onchange = () =>
      sb.from("saved_searches").update({ email_enabled: c.checked }).eq("id", c.dataset.email)));
    body.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
      await sb.from("saved_searches").delete().eq("id", b.dataset.del); render();
    }));
    $("#acctOut").onclick = async () => { await sb.auth.signOut(); };
    $("#acctDelete").onclick = async () => {
      if (!confirm("Delete your account, saved resume, tracker and alerts? This can't be undone.")) return;
      const { error } = await sb.rpc("delete_my_account");
      if (error) return note("Couldn't delete: " + error.message);
      await sb.auth.signOut();
      note("Your account and its data were deleted.");
    };
  }

  async function init() {
    $("#acctBtn").hidden = false;
    $("#acctBtn").onclick = open;
    $("#acctClose").onclick = close;
    $("#acctScrim").onclick = close;
    try { await loadSdk(); } catch (e) { $("#acctBtn").title = e.message; return; }
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { detectSessionInUrl: true, persistSession: true } });
    sb.auth.onAuthStateChange((event, session) => {
      const was = user?.id;
      user = session?.user || null;
      if (user && user.id !== was) pull().catch((e) => console.warn("sync failed", e));
      if (!user && was) render();
      if (!$("#account").hidden) render();
      $("#acctBtn").textContent = user ? "👤 Account" : "Sign in";
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
