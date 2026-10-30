// Export the public company list + sponsorship stats for the nightly job feed.
//
// Runs locally (it reads a career-ops install and the DOL/USCIS work products),
// writes two committed files that CI uses:
//   feed/portals.yml   — career-ops scanner config: public title/location
//                        filters + one tracked board per sponsoring company
//   feed/sponsors.json — company name -> DOL/USCIS sponsorship summary
//
// Usage: node scripts/export-companies.mjs <career-ops dir> [lca-employers.json]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const [coDir, lcaPath] = process.argv.slice(2);
if (!coDir) { console.error('usage: node scripts/export-companies.mjs <career-ops dir> [lca-employers.json]'); process.exit(1); }
const yaml = createRequire(path.join(path.resolve(coDir), 'package.json'))('js-yaml');
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', 'feed');
const read = (p, d = null) => { try { return fs.readFileSync(p, 'utf8'); } catch { return d; } };

// Employers that tell applicants they do not sponsor, whatever their filing history.
const NO_SPONSOR = /^(target|capital ?one)\b/i;
const STAFFING_SHARE = 0.4;
const key = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// Posting URL -> the company's board URL, for the providers the scanner reads
// through public JSON APIs.
function boardOf(url) {
  let m;
  if ((m = url.match(/^https:\/\/(?:job-boards|boards)\.greenhouse\.io\/([\w-]+)\/jobs\//))) return `https://job-boards.greenhouse.io/${m[1]}`;
  if ((m = url.match(/^https:\/\/jobs\.lever\.co\/([\w.-]+)\//))) return `https://jobs.lever.co/${m[1]}`;
  if ((m = url.match(/^https:\/\/jobs\.ashbyhq\.com\/([\w.%-]+)\//))) return `https://jobs.ashbyhq.com/${m[1]}`;
  if ((m = url.match(/^https:\/\/([\w-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([\w-]+)\/job\//))) return `https://${m[1]}.${m[2]}.myworkdayjobs.com/${m[3]}`;
  if ((m = url.match(/^https:\/\/(careers-[\w-]+)\.icims\.com\/jobs\//))) return `https://${m[1]}.icims.com/jobs`;
  return null;
}

// --- inputs -----------------------------------------------------------------
const portals = yaml.load(read(path.join(coDir, 'portals.yml')));
const h1b = JSON.parse(read(path.join(coDir, 'data/h1b-companies.json'), '{"companies":{}}')).companies;
const uscis = JSON.parse(read(path.join(coDir, 'data/uscis-matches.json'), '[]'));
const lca = lcaPath ? JSON.parse(read(lcaPath, '[]')) : [];
const lcaByKey = new Map(lca.map((e) => [key(e.name), e]));

const firstUrl = new Map();
const hist = (read(path.join(coDir, 'data/scan-history.tsv'), '') || '').split(/\r?\n/);
const head = hist[0].split('\t');
const iu = head.indexOf('url'), ic = head.indexOf('company');
for (const l of hist.slice(1)) {
  const c = l.split('\t');
  const b = c[iu] && boardOf(c[iu]);
  if (b && c[ic] && !firstUrl.has(c[ic])) firstUrl.set(c[ic], b);
}

// USCIS approvals/denials are recorded per matched posting; one row per company is enough.
const uscisBy = new Map();
for (const u of uscis) if (u.company && !uscisBy.has(key(u.company))) uscisBy.set(key(u.company), u);

// --- company set -------------------------------------------------------------
const boards = new Map(); // name -> careers_url
for (const c of portals.tracked_companies || []) {
  if (c.enabled === false || !/greenhouse\.io|jobs\.lever\.co|ashbyhq\.com|myworkdayjobs\.com|icims\.com/.test(c.careers_url || '')) continue;
  if (NO_SPONSOR.test(c.name)) continue;
  boards.set(c.name, c.careers_url);
}
for (const [name, r] of Object.entries(h1b)) {
  if (boards.has(name) || NO_SPONSOR.test(name)) continue;
  if (!['strong', 'moderate'].includes(r.tier) || r.review || (r.staffingShare || 0) >= STAFFING_SHARE) continue;
  const b = firstUrl.get(name);
  if (b) boards.set(name, b);
}
// One entry per board URL (two display names can point at the same board).
const seenBoard = new Set();
const companies = [...boards].filter(([, u]) => !seenBoard.has(u) && seenBoard.add(u)).sort((a, b) => a[0].localeCompare(b[0]));

// Re-match every exported company against the DOL index (scan-monitor's
// h1b-filter.mjs), so boards added by hand get stats even before they appear
// in a scan. The fresh match wins over the scan-time one.
const filter = path.join(path.resolve(coDir), '..', 'scan-monitor', 'h1b-filter.mjs');
if (fs.existsSync(filter)) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-'));
  fs.writeFileSync(path.join(tmp, 'names.txt'), companies.map(([n]) => n).join('\n'));
  execFileSync(process.execPath, [filter, path.resolve(coDir), '--names', path.join(tmp, 'names.txt'), '--out', path.join(tmp, 'h1b.json')], { stdio: 'inherit' });
  Object.assign(h1b, JSON.parse(fs.readFileSync(path.join(tmp, 'h1b.json'), 'utf8')).companies);
  fs.rmSync(tmp, { recursive: true, force: true });
}

// --- sponsorship summaries ---------------------------------------------------
// Boards found by the all-boards sweep are named by their slug ("cisco",
// "elevancehealth"); show the employer's DOL name instead, cleaned up.
const LEGAL = /,?\s*\b(incorporated|inc|llc|l\.l\.c|corp|corporation|company|co|ltd|limited|lp|l\.p|llp|pbc|n\.a|plc|holdings?|us|usa|u\.s\.a?)\b\.?/gi;
function displayName(name, entity) {
  if (!entity || /[A-Z\s]/.test(name)) return name;
  let s = entity.replace(/\(.*?\)/g, ' ').replace(LEGAL, ' ').replace(/[,.\s&]+$/g, '').replace(/\s+/g, ' ').trim();
  if (s === s.toUpperCase()) s = s.split(' ').map((w) => (w.length <= 3 && !/[aeiou]/i.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase())).join(' ');
  return s || name;
}
const sponsors = {};
for (const [name] of companies) {
  const r = h1b[name];
  // No stats beats wrong stats: skip unmatched and low-confidence matches.
  if (!r || !r.entity || r.review) continue;
  const l = lcaByKey.get(key(r.entity));
  const u = uscisBy.get(key(name));
  const decided = u ? (u.approvals || 0) + (u.denials || 0) : 0;
  sponsors[name] = {
    display: displayName(name, r.entity),
    tier: r.tier,
    entity: r.entity,
    filings: r.lca,
    green_cards: r.perm,
    years: r.years,
    staffing: (r.staffingShare || 0) >= STAFFING_SHARE,
    median_wage: l?.medianWage ?? null,
    fy26_tech_filings: l?.filings ?? null,
    top_titles: l?.topTitles ?? null,
    approval_rate: decided >= 5 ? Math.round((1000 * u.approvals) / decided) / 1000 : null,
  };
}

// --- write -------------------------------------------------------------------
const q = (s) => JSON.stringify(s);
const list = (xs) => xs.map((x) => `    - ${q(x)}`).join('\n');
const POSITIVE = ['Engineer', 'Developer', 'Scientist', 'Architect', 'Programmer', 'Analyst', 'SRE', 'DevOps',
  'Machine Learning', 'Data', 'Software', 'AI', 'ML', 'Full Stack', 'Backend', 'Frontend', 'Cloud', 'Security'];
const NEGATIVE = ['Intern', 'Internship', 'Co-op', 'Sales', 'Recruiter', 'Recruiting', 'Account Executive', 'Account Manager',
  'Marketing', 'Nurse', 'Driver', 'Technician', 'Warehouse', 'Customer Success', 'Paralegal', 'Attorney'];
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'portals.yml'), `# Generated by scripts/export-companies.mjs — edit that script, not this file.
# career-ops scanner config for the public SponsorPilot feed: one board per
# employer with an H-1B filing history (DOL LCA), public tech-role filters, US only.

title_filter:
  positive:
${list(POSITIVE)}
  negative:
${list(NEGATIVE)}

location_filter:
  always_allow:
    - "United States"
    - "USA"
  allow:
    - "United States"
    - "USA"

max_posting_age_days: 30

tracked_companies:
${companies.map(([n, u]) => `  - name: ${q(n)}\n    careers_url: ${u}\n    enabled: true`).join('\n')}
`);
fs.writeFileSync(path.join(OUT, 'sponsors.json'), JSON.stringify(sponsors, null, 1) + '\n');
console.log(`companies ${companies.length} (with sponsorship stats ${Object.keys(sponsors).length}) -> ${OUT}`);
