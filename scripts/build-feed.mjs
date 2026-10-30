// Turn a career-ops scan of feed/portals.yml into the site's job feed.
//
// Reads feed/data/pipeline.md (the scanner's output for this run — every open
// posting that passed the filters), joins sponsorship stats from
// feed/sponsors.json, fetches each new posting's description through the ATS's
// public API (cached in feed/jd-cache.json), tags skills and sponsorship /
// citizenship / clearance language, and writes:
//   web/data/jobs.json  — { companies: name -> sponsorship, jobs: [...] }; the
//                         description itself stays on the employer's page (size)
//   web/data/meta.json  — run stats + the date that counts as "new"
//
// Usage: SCANNER_DIR=<career-ops checkout> node scripts/build-feed.mjs [--max-fetch 4000]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const MAX_FETCH = Number(args[args.indexOf('--max-fetch') + 1]) || 4000;
const CONCURRENCY = 8;
const RETRY_MISS_DAYS = 1;
const today = new Date().toISOString().slice(0, 10);

const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const writeJson = (p, v, pretty) => fs.writeFileSync(p, JSON.stringify(v, null, pretty ? 1 : 0) + '\n');

const scanner = process.env.SCANNER_DIR;
if (!scanner) { console.error('Set SCANNER_DIR to a career-ops checkout.'); process.exit(1); }
// Node's bundled undici can die on a rare socket state (assert(!this.paused))
// in a way no try/catch reaches; the scanner's own undici is newer.
try { globalThis.fetch = createRequire(path.join(path.resolve(scanner), 'package.json'))('undici').fetch; } catch {}
const { fetchJdViaKnownApi } = await import(pathToFileURL(path.join(path.resolve(scanner), 'browser-extract.mjs')).href);

// --- inputs -------------------------------------------------------------------
const postings = [];
for (const l of fs.readFileSync(path.join(ROOT, 'feed/data/pipeline.md'), 'utf8').split(/\r?\n/)) {
  if (!/^- \[ \] https?:\/\//.test(l)) continue;
  const [url, company = '', title = '', ...rest] = l.slice(6).split(' | ');
  postings.push({
    url: url.trim(), company: company.trim(), title: title.trim(),
    location: (rest.find((r) => r && !r.startsWith('posted:')) || '').trim(),
    posted: ((rest.find((r) => r.startsWith('posted:')) || '').slice(7)).trim().slice(0, 10) || null,
  });
}
const sponsors = readJson(path.join(ROOT, 'feed/sponsors.json'), {});
const cachePath = path.join(ROOT, 'feed/jd-cache.json');
const cache = readJson(cachePath, {});
const seenPath = path.join(ROOT, 'feed/first-seen.json');
const firstSeen = readJson(seenPath, {});
let firstRun = !Object.keys(firstSeen).length; // every job would be "new" — show none
const SKILLS = readJson(path.join(ROOT, 'web/data/skills.json'), [])
  .map(([name, pat, cs]) => [name, new RegExp(pat, cs ? '' : 'i')]);

// --- JD signals -----------------------------------------------------------------
const NO_SPONSOR = /(will not|won't|unable to|cannot|can ?not|do(es)? not|not able to) (offer |provide )?(visa |h-?1b )?(sponsor|support)|not (be )?(eligible|available) for (visa |immigration )?sponsorship|no (visa )?sponsorship|without (the need for )?(current or future |future )?(visa |employer |employment )?sponsorship|sponsorship (is )?not (available|offered|provided)|must not require sponsorship/i;
const CITIZEN = /(must|required to) be an? u\.?s\.? citizen|u\.?s\.? citizenship (is )?required|requires u\.?s\.? citizenship|only u\.?s\.? citizens/i;
const CLEARANCE = /(active|current|obtain|maintain|eligib\w+ (for|to obtain)|requires?|required)\b.{0,40}(security clearance|secret clearance|ts\/sci|top secret|public trust)/i;
const line = (text, re) => {
  const hit = text.split(/(?<=[.!?])\s+|\n/).find((s) => re.test(s));
  return hit ? hit.trim().slice(0, 220) : null;
};
const skillsOf = (text) => SKILLS.filter(([, re]) => re.test(text)).map(([n]) => n).slice(0, 14);

function signals(jdText, title) {
  const text = String(jdText || '').replace(/\s+\n/g, '\n');
  const flags = {};
  const ns = line(text, NO_SPONSOR), ct = line(text, CITIZEN), cl = line(text, CLEARANCE);
  if (ns) flags.no_sponsor = ns;
  if (ct) flags.citizenship = ct;
  if (cl) flags.clearance = cl;
  return { s: skillsOf(`${title}\n${text}`), f: flags, t: today };
}

// --- fetch descriptions for postings not in the cache -----------------------------
const daysSince = (d) => (Date.parse(today) - Date.parse(d)) / 864e5;
const todo = postings.filter((p) => {
  const c = cache[p.url];
  return !c || (c.miss && daysSince(c.t) >= RETRY_MISS_DAYS);
}).slice(0, MAX_FETCH);

// undici (bundled and npm alike) can throw assert(!this.paused) from a socket
// 'end' handler, outside any request's promise. That request still settles via
// its own timeout, so log it and keep going instead of losing the run.
process.on('uncaughtException', (e) => {
  if (e?.code === 'ERR_ASSERTION' && /paused/.test(String(e.message) + e.stack)) { console.warn('[warn] undici socket assert ignored'); return; }
  writeJson(cachePath, cache);
  throw e;
});

// Workday tenants throttle parallel requests, so cap requests in flight per
// host; the second pass retries what the first missed, one at a time per host
// with a pause. Anything still missing is retried on the next night's run.
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
let done = 0;
async function fetchPass(list, perHost, gapMs) {
  const inflight = new Map();
  // Round-robin across hosts so the next eligible posting is near the front.
  const byHost = new Map();
  for (const p of list) { const h = hostOf(p.url); if (!byHost.has(h)) byHost.set(h, []); byHost.get(h).push(p); }
  const queue = [];
  for (let added = true, i = 0; added; i++) {
    added = false;
    for (const l of byHost.values()) if (i < l.length) { queue.push(l[i]); added = true; }
  }
  const next = () => {
    const i = queue.findIndex((p) => (inflight.get(hostOf(p.url)) || 0) < perHost);
    return i < 0 ? null : queue.splice(i, 1)[0];
  };
  let ok = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const p = next();
      if (!p) { await sleep(50); continue; }
      const h = hostOf(p.url);
      inflight.set(h, (inflight.get(h) || 0) + 1);
      let r = null;
      try { r = await fetchJdViaKnownApi(p.url, 20000, 20000); } catch { r = null; }
      if (gapMs) await sleep(gapMs);
      inflight.set(h, inflight.get(h) - 1);
      if (r?.text?.trim()) { cache[p.url] = signals(r.text, p.title); ok++; }
      else cache[p.url] = { miss: 1, t: today };
      // Checkpoint, so a crash resumes instead of refetching everything.
      if (++done % 500 === 0) writeJson(cachePath, cache);
    }
  }));
  return ok;
}
let fetched = await fetchPass(todo, 2, 0);
const retry = todo.filter((p) => cache[p.url]?.miss);
fetched += await fetchPass(retry, 1, 400);
const missed = todo.filter((p) => cache[p.url]?.miss).length;

// --- assemble -------------------------------------------------------------------------
const current = new Set(postings.map((p) => p.url));
for (const u of Object.keys(cache)) if (!current.has(u)) delete cache[u];
for (const u of Object.keys(firstSeen)) if (!current.has(u)) delete firstSeen[u];

const seenUrl = new Set();
const jobs = [];
for (const p of postings) {
  if (seenUrl.has(p.url)) continue;
  seenUrl.add(p.url);
  firstSeen[p.url] ||= today;
  const c = cache[p.url] && !cache[p.url].miss ? cache[p.url] : { s: skillsOf(p.title), f: {} };
  const job = {
    id: crypto.createHash('sha1').update(p.url).digest('hex').slice(0, 12),
    title: p.title,
    company: sponsors[p.company]?.display || p.company,
    location: p.location,
    url: p.url,
    posted: p.posted,
    first_seen: firstSeen[p.url],
    skills: c.s,
  };
  if (Object.keys(c.f || {}).length) job.flags = c.f;
  jobs.push(job);
}
// Sponsorship once per company; the site attaches it to each job on load.
const companies = {};
const byDisplay = new Map(Object.entries(sponsors).map(([n, sp]) => [sp.display || n, sp]));
for (const name of new Set(jobs.map((j) => j.company))) {
  const sp = byDisplay.get(name);
  companies[name] = sp
    ? { sponsors: !sp.staffing, tier: sp.tier, filings: sp.filings, green_cards: sp.green_cards, years: sp.years,
        approval_rate: sp.approval_rate, median_wage: sp.median_wage }
    : { sponsors: null };
}
jobs.sort((a, b) => (b.first_seen || '').localeCompare(a.first_seen || '') || (b.posted || '').localeCompare(a.posted || ''));

// A run where nothing predates today (a re-seeded feed) is a first run too.
if (jobs.every((j) => j.first_seen === today)) firstRun = true;
fs.mkdirSync(path.join(ROOT, 'web/data'), { recursive: true });
writeJson(path.join(ROOT, 'web/data/jobs.json'), { companies, jobs });
writeJson(path.join(ROOT, 'web/data/meta.json'), {
  generated_at: new Date().toISOString(),
  latest_day: firstRun ? null : today,
  jobs: jobs.length,
  companies: Object.keys(companies).length,
  new_today: firstRun ? 0 : jobs.filter((j) => j.first_seen === today).length,
  descriptions_pending: postings.filter((p) => !cache[p.url]).length,
}, true);
writeJson(cachePath, cache);
writeJson(seenPath, firstSeen);
console.log(`jobs ${jobs.length} · new today ${jobs.filter((j) => j.first_seen === today).length} · JDs fetched ${fetched}, missed ${missed}, still pending ${postings.filter((p) => !cache[p.url]).length}`);
