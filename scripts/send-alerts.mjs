// Daily job-alert digest: after the nightly feed, email each user the new
// postings that match their saved searches (one email per user).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
//      ALERT_FROM (e.g. "SponsorPilot <alerts@arikatla.dev>"), SITE_URL.
// Missing settings → logs and exits 0, so the nightly run never fails on it.
//
// Usage: node scripts/send-alerts.mjs [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const PER_SEARCH = 15;
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: KEY, RESEND_API_KEY, ALERT_FROM } = process.env;
const SITE = (process.env.SITE_URL || 'https://jobs.arikatla.dev').replace(/\/$/, '');

if (!SUPABASE_URL || !KEY || (!RESEND_API_KEY && !DRY) || (!ALERT_FROM && !DRY)) {
  console.log('Alerts not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / RESEND_API_KEY / ALERT_FROM); skipping.');
  process.exit(0);
}

const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/data/meta.json'), 'utf8'));
if (!meta.latest_day) { console.log('First feed run — nothing counts as new yet; no alerts.'); process.exit(0); }
const feed = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/data/jobs.json'), 'utf8'));
const fresh = feed.jobs.filter((j) => j.first_seen === meta.latest_day);
console.log(`${fresh.length} new postings on ${meta.latest_day}`);

const today = new Date().toISOString().slice(0, 10);
const rest = async (p, init = {}) => {
  const r = await fetch(`${SUPABASE_URL}${p}`, { ...init, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${p} -> ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
};

// --- who wants what ----------------------------------------------------------
const searches = (await rest('/rest/v1/saved_searches?email_enabled=eq.true&select=*'))
  .filter((s) => !s.last_sent_at || s.last_sent_at.slice(0, 10) < today);
if (!searches.length) { console.log('No active alerts due.'); process.exit(0); }
const userIds = [...new Set(searches.map((s) => s.user_id))];
const profiles = await rest(`/rest/v1/profiles?select=id,resume&id=in.(${userIds.join(',')})`);
const skillsOf = new Map(profiles.map((p) => [p.id, new Set(String(p.resume?.skills || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean))]));
const emails = new Map();
for (let page = 1; ; page++) {
  const { users } = await rest(`/auth/v1/admin/users?page=${page}&per_page=1000`);
  for (const u of users) emails.set(u.id, u.email);
  if (users.length < 1000) break;
}

// --- matching (same rules as the site's Find Jobs filters) ---------------------
const blocked = (j) => j.flags && (j.flags.no_sponsor || j.flags.citizenship || j.flags.clearance);
const tierRank = { strong: 2, moderate: 1 };
function matches(s) {
  const q = s.query.trim().toLowerCase(), loc = s.location.trim().toLowerCase();
  return fresh.filter((j) => {
    const sp = feed.companies[j.company] || {};
    if (s.sponsors_only && !sp.sponsors) return false;
    if (s.hide_no_sponsor && blocked(j)) return false;
    if (q && !`${j.title} ${j.company} ${(j.skills || []).join(' ')}`.toLowerCase().includes(q)) return false;
    if (loc && !`${j.location} ${/remote/i.test(j.location) ? 'remote' : ''}`.toLowerCase().includes(loc)) return false;
    return true;
  });
}
function fit(j, mine) {
  const need = (j.skills || []).map((x) => x.toLowerCase());
  return mine.size && need.length ? Math.round((100 * need.filter((x) => mine.has(x)).length) / need.length) : null;
}

// --- email -----------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shortLoc = (l) => { const p = String(l || '').split(/\s+[·/;|]\s+/); return p.slice(0, 2).join(' · ') + (p.length > 2 ? ` +${p.length - 2} more` : ''); };
function section(s, jobs, mine) {
  const ranked = jobs.map((j) => ({ j, f: fit(j, mine), t: tierRank[feed.companies[j.company]?.tier] || 0 }))
    .sort((a, b) => (b.f ?? -1) - (a.f ?? -1) || b.t - a.t).slice(0, PER_SEARCH);
  const label = [s.query || 'Any role', s.location].filter(Boolean).join(' · ');
  return `<h3 style="margin:22px 0 6px;font:600 16px system-ui">${esc(label)} — ${jobs.length} new</h3>` +
    ranked.map(({ j, f }) => {
      const sp = feed.companies[j.company] || {};
      return `<div style="padding:10px 0;border-bottom:1px solid #e3e7ee;font:14px system-ui">
        <a href="${esc(j.url)}" style="color:#2f6fed;font-weight:600;text-decoration:none">${esc(j.title)}</a><br>
        <span style="color:#5b6470">${esc(j.company)} · ${esc(shortLoc(j.location))}${f != null ? ` · <b>${f}% fit</b>` : ''}${sp.filings ? ` · ${sp.filings.toLocaleString('en-US')} H-1B filings` : ''}</span></div>`;
    }).join('') +
    (jobs.length > ranked.length ? `<p style="font:13px system-ui"><a href="${SITE}/?q=${encodeURIComponent(s.query)}&loc=${encodeURIComponent(s.location)}&new=1">See all ${jobs.length} on SponsorPilot →</a></p>` : '') +
    `<p style="font:12px system-ui;color:#5b6470"><a href="${SITE}/unsubscribe.html?t=${s.unsub_token}" style="color:#5b6470">Stop this alert</a></p>`;
}

const byUser = new Map();
for (const s of searches) { if (!byUser.has(s.user_id)) byUser.set(s.user_id, []); byUser.get(s.user_id).push(s); }
let sent = 0;
for (const [uid, list] of byUser) {
  const to = emails.get(uid);
  if (!to) continue;
  const mine = skillsOf.get(uid) || new Set();
  const parts = list.map((s) => ({ s, jobs: matches(s) })).filter((x) => x.jobs.length);
  if (!parts.length) continue;
  const total = parts.reduce((n, x) => n + x.jobs.length, 0);
  const html = `<div style="max-width:620px;margin:auto">
    <h2 style="font:700 20px system-ui;margin:0 0 4px">${total} new sponsor-friendly job${total === 1 ? '' : 's'} for you</h2>
    <p style="font:13px system-ui;color:#5b6470;margin:0">Found in last night's scan of ${feed.jobs.length.toLocaleString('en-US')} open roles. Sponsorship history is from public DOL/USCIS data — always read the posting.</p>
    ${parts.map((x) => section(x.s, x.jobs, mine)).join('')}
    <p style="font:12px system-ui;color:#5b6470;margin-top:24px">You get this because you saved a search on <a href="${SITE}">SponsorPilot</a>.
      Manage alerts from the Account menu. <a href="${SITE}/privacy.html" style="color:#5b6470">Privacy</a></p></div>`;
  const subject = `${total} new job${total === 1 ? '' : 's'} at H-1B sponsors — ${parts.map((x) => x.s.query || 'any role').join(', ').slice(0, 60)}`;
  if (DRY) { console.log(`[dry-run] ${to}: ${subject}`); sent++; continue; }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: ALERT_FROM, to: [to], subject, html,
      headers: { 'List-Unsubscribe': `<${SITE}/unsubscribe.html?t=${parts[0].s.unsub_token}>` },
    }),
  });
  if (!r.ok) { console.warn(`send to user ${uid} failed: ${r.status} ${await r.text()}`); continue; }
  await rest(`/rest/v1/saved_searches?id=in.(${list.map((s) => s.id).join(',')})`, { method: 'PATCH', body: JSON.stringify({ last_sent_at: new Date().toISOString() }), headers: { Prefer: 'return=minimal' } });
  sent++;
  await new Promise((ok) => setTimeout(ok, 600)); // Resend free tier: 2 requests/second
}
console.log(`alert emails sent: ${sent}`);
