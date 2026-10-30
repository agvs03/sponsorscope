// Turn a career-ops scan of feed/portals.yml into the site's job feed.
//
// Reads feed/data/pipeline.md (the scanner's output for this run — every open
// posting that passed the filters), joins sponsorship stats from
// feed/sponsors.json, fetches each new posting's description through the ATS's
// public API (cached in feed/jd-cache.json), tags skills and sponsorship /
// citizenship / clearance language, and writes:
//   web/data/jobs.json  — the list the site renders
//   web/data/meta.json  — run stats + the date that counts as "new"
//
// Usage: SCANNER_DIR=<career-ops checkout> node scripts/build-feed.mjs [--max-fetch 4000]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const MAX_FETCH = Number(args[args.indexOf('--max-fetch') + 1]) || 4000;
const CONCURRENCY = 8;
const RETRY_MISS_DAYS = 3;
const today = new Date().toISOString().slice(0, 10);

const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const writeJson = (p, v, pretty) => fs.writeFileSync(p, JSON.stringify(v, null, pretty ? 1 : 0) + '\n');
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const scanner = process.env.SCANNER_DIR;
if (!scanner) { console.error('Set SCANNER_DIR to a career-ops checkout.'); process.exit(1); }
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
  return { s: skillsOf(`${title}\n${text}`), d: text.replace(/\s+/g, ' ').trim().slice(0, 420), f: flags, t: today };
}

// --- fetch descriptions for postings not in the cache -----------------------------
const daysSince = (d) => (Date.parse(today) - Date.parse(d)) / 864e5;
const todo = postings.filter((p) => {
  const c = cache[p.url];
  return !c || (c.miss && daysSince(c.t) >= RETRY_MISS_DAYS);
}).slice(0, MAX_FETCH);
let fetched = 0, missed = 0;
const queue = [...todo];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const p = queue.shift();
    let r = null;
    try { r = await fetchJdViaKnownApi(p.url, 20000, 20000); } catch { r = null; }
    if (r?.text?.trim()) { cache[p.url] = signals(r.text, p.title); fetched++; }
    else { cache[p.url] = { miss: 1, t: today }; missed++; }
  }
}));

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
  const c = cache[p.url] && !cache[p.url].miss ? cache[p.url] : { s: skillsOf(p.title), d: '', f: {} };
  const sp = sponsors[p.company];
  jobs.push({
    id: crypto.createHash('sha1').update(p.url).digest('hex').slice(0, 12),
    title: p.title,
    company: p.company,
    company_slug: slug(p.company),
    location: p.location,
    remote: /remote/i.test(p.location),
    url: p.url,
    posted: p.posted,
    first_seen: firstSeen[p.url],
    skills: c.s,
    description: c.d,
    flags: c.f,
    sponsorship: sp
      ? { sponsors: !sp.staffing, tier: sp.tier, filings: sp.filings, green_cards: sp.green_cards, years: sp.years,
          approval_rate: sp.approval_rate, median_wage: sp.median_wage }
      : { sponsors: null },
  });
}
jobs.sort((a, b) => (b.first_seen || '').localeCompare(a.first_seen || '') || (b.posted || '').localeCompare(a.posted || ''));

fs.mkdirSync(path.join(ROOT, 'web/data'), { recursive: true });
writeJson(path.join(ROOT, 'web/data/jobs.json'), jobs);
writeJson(path.join(ROOT, 'web/data/meta.json'), {
  generated_at: new Date().toISOString(),
  latest_day: today,
  jobs: jobs.length,
  companies: new Set(jobs.map((j) => j.company)).size,
  new_today: jobs.filter((j) => j.first_seen === today).length,
  descriptions_pending: postings.filter((p) => !cache[p.url]).length,
}, true);
writeJson(cachePath, cache);
writeJson(seenPath, firstSeen);
console.log(`jobs ${jobs.length} · new today ${jobs.filter((j) => j.first_seen === today).length} · JDs fetched ${fetched}, missed ${missed}, still pending ${postings.filter((p) => !cache[p.url]).length}`);
