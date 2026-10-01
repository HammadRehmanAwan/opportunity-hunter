#!/usr/bin/env node
// Merges research-partial.json (roles) + enrich/verify workflow outputs (+ optional draft outputs)
// into either a dossier (stage=dossier) or the site's data/opportunities.json (stage=final).
// usage: node assemble.mjs dossier|final <scratchpad> <outfile>
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const [stage, SP, outFile] = process.argv.slice(2);
const TODAY = process.env.OH_TODAY || new Date().toISOString().slice(0, 10);
const partial = JSON.parse(readFileSync(join(SP, 'research-partial.json'), 'utf8'));
const readOutputs = (prefix) => readdirSync(join(SP, 'results')).filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
  .map((f) => { const j = JSON.parse(readFileSync(join(SP, 'results', f), 'utf8')); return j.result || j; });

const enrichRuns = readOutputs('enrich-');
const byCompany = new Map();
for (const run of enrichRuns) for (const r of (run.results || [])) byCompany.set(r.company, { ...r });
// lean verification runs: newer verification wins; fresh enrichment fills gaps
for (const run of readOutputs('verify-')) for (const r of (run.results || [])) {
  const cur = byCompany.get(r.company) || { company: r.company };
  if (r.enrichment) cur.enrichment = r.enrichment;
  if (r.verification) cur.verification = r.verification;
  byCompany.set(r.company, cur);
}
const jobStatus = (v) => !v ? 'unconfirmed' : (v.job_status || (v.job_url_live === true ? 'listed_recently' : 'unconfirmed'));
const draftRuns = stage === 'final' ? readOutputs('draft-') : [];
const drafts = new Map();
for (const run of draftRuns) for (const r of (run.results || [])) drafts.set(r.company, r);

const isHttp = (u) => /^https?:\/\//i.test(u || '');
const isEmail = (e) => /^[^\s@,;:<>?&"'()[\]\\]+@[^\s@,;:<>?&"'()[\]\\/]+\.[a-z]{2,}$/i.test(e || '');
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const domainOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };

// Build a guessed address from a documented pattern. Only simple, unambiguous patterns; else null.
function guessEmail(pattern, name, website) {
  const p = clean(pattern).toLowerCase();
  const m = p.match(/^([a-z._-]*(?:first|last|f|l)[a-z._-]*)@([a-z0-9.-]+\.[a-z]{2,})/);
  if (!m) return null;
  const raw = clean(name);
  if (/[()\[\],]/.test(raw)) return null;                       // bracketed or comma'd names are ambiguous
  let parts = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.some((t) => /\.$/.test(t) && t.length <= 3 && t !== parts[0])) { parts = parts.filter((t, i) => i === 0 || i === parts.length - 1 || !/^[a-z]\.?$/.test(t)); }
  if (parts.length && /^[a-z]\.?$/.test(parts[parts.length - 1])) return null;   // abbreviated surname (e.g. "Zoe C.")
  parts = parts.filter((t, i) => i === 0 || i === parts.length - 1 || !/^[a-z]\.?$/.test(t)); // drop middle initials
  if (parts.some((t) => /^(van|von|der|de|da|di|du|del|della|le|la|al|bin|ibn|st\.?)$/.test(t))) return null;
  parts = parts.map((t) => t.replace(/[^a-z-]/g, ''));
  if (parts.length !== 2 || parts.some((t) => t.length < 2)) return null;
  const first = parts[0], last = parts[parts.length - 1];
  let local = m[1];
  if (!/^(first\.last|first|flast|firstlast|first_last|f\.last|firstl|first-last|last)$/.test(local)) return null;
  local = local.replace('first', '§F').replace('last', '§L');
  local = local.replace(/§F/g, first).replace(/§L/g, last).replace(/^f(?=[._-]?\w)/, first[0]).replace(/l$/, '');
  // recompute properly for the two initial-based forms
  if (m[1] === 'flast') local = first[0] + last;
  if (m[1] === 'f.last') local = `${first[0]}.${last}`;
  if (m[1] === 'firstl') local = first + last[0];
  if (m[1] === 'first') local = first;
  if (m[1] === 'last') local = last;
  const domain = m[2];
  const site = domainOf(website);
  const label = (h) => { const p = String(h || '').toLowerCase().split('.'); const two = p.slice(-2).join('.'); const n = /^(co|com|org|ac|gov|net|ltd|plc)\.[a-z]{2}$/.test(two) ? 3 : 2; return p.length >= n ? p[p.length - n] : h; };
  if (site && domain !== site && !site.endsWith('.' + domain) && !domain.endsWith('.' + site) && label(domain) !== label(site)) return null;
  const email = `${local}@${domain}`;
  return isEmail(email) ? email : null;
}

const confOf = (x) => { const m = String(x || '').toLowerCase().match(/^\s*(high|medium-low|low-medium|medium|low|none)/); return m ? m[1] : ''; };
const patternOf = (x) => { const m = String(x || '').match(/[a-z._{}-]+@[a-z0-9.-]+\.[a-z]{2,}/i); return m ? m[0].toLowerCase() : ''; };
// Verifier notes are written for us; keep a short, reader-facing sentence and drop tooling chatter.
const tidyIssue = (t) => {
  let x = clean(t).replace(/\([^)]*\b(blocked|budget|quota|searches?|fetch\w*|egress|proxy|snippet)\b[^)]*\)/gi, '');
  const sentences = x.split(/(?<=[.;])\s+/).filter((z) => !/\b(blocked|budget|quota|no searches|egress|proxy|could not fetch|couldn't fetch|couldn't open|session|api endpoint)\b/i.test(z));
  x = (sentences[0] || '').replace(/\s+([.,;:])/g, '$1').replace(/\s{2,}/g, ' ').trim().replace(/[;,:]$/, '.');
  if (x.length > 180) x = x.slice(0, 177).replace(/\s+\S*$/, '') + '…';
  return x;
};
const RECRUIT = /^(careers?|jobs|talent|talentacquisition|recruit\w*|hiring|people|hr|join|work)@/i;
// A published address counts only if it is on a company domain (website, documented pattern or careers inbox).
// Personal inboxes found in commits/CVs are deliberately not used for cold outreach.
const emailDomain = (x) => String(x || '').toLowerCase().split('@')[1] || '';
const orgLabel = (h) => { const p = String(h || '').toLowerCase().split('.'); const two = p.slice(-2).join('.'); const n = /^(co|com|org|ac|gov|net|ltd|plc)\.[a-z]{2}$/.test(two) ? 3 : 2; return p.length >= n ? p[p.length - n] : h; };
const sameOrg = (a, b) => !!a && !!b && (a === b || a.endsWith('.' + b) || b.endsWith('.' + a) || orgLabel(a) === orgLabel(b));
const workDomains = (e) => [domainOf(e && e.website), emailDomain(patternOf(e && e.email_pattern)), emailDomain(e && e.careers_email)].filter(Boolean);
const isWorkEmail = (addr, e) => workDomains(e).some((d) => sameOrg(emailDomain(addr), d));
let personalDropped = 0;
const out = [];
for (const c of partial.kept) {
  const run = byCompany.get(c.company);
  const e = (run && run.enrichment) || c.enrichment;
  const v = run && run.verification;
  if (stage === 'final' && !e) { console.error(`skip ${c.company}: no enrichment`); continue; }
  let role = c.roles[0];
  // Public page for ATS API URLs (e.g. SmartRecruiters posting API -> jobs.smartrecruiters.com)
  const publicUrl = (u) => { const m = String(u || '').match(/^https:\/\/api\.smartrecruiters\.com\/v1\/companies\/([^/]+)\/postings\/(\d+)/); return m ? `https://jobs.smartrecruiters.com/${m[1]}/${m[2]}` : u; };
  let job_url = publicUrl(role.job_url);
  // Use the verifier's alternate URL only for an unconfirmed listing (same role, better link); drafts are written for the primary role.
  const alt_job_url = v && isHttp(v.alternate_job_url) && v.alternate_job_url !== role.job_url ? v.alternate_job_url : '';
  if (alt_job_url && jobStatus(v) === 'unconfirmed') job_url = alt_job_url;
  const contacts = (e && e.contacts ? e.contacts : []).map((ct) => {
    const vc = v && v.contacts ? v.contacts.find((x) => clean(x.name).toLowerCase() === clean(ct.name).toLowerCase()) : null;
    const ve = v && v.emails ? v.emails.find((x) => x.email && ct.email_public && x.email.toLowerCase() === ct.email_public.toLowerCase()) : null;
    let email = '', email_status = '', email_source_url = '';
    if (isEmail(ct.email_public) && !isWorkEmail(ct.email_public, e)) personalDropped++;
    if (isEmail(ct.email_public) && isWorkEmail(ct.email_public, e) && (ve ? ve.verified_public : isHttp(ct.email_public_source_url))) { email = ct.email_public; email_status = 'verified_public'; email_source_url = (ve && ve.source_url) || ct.email_public_source_url || ''; }
    else if (e && patternOf(e.email_pattern) && (confOf(e.email_pattern_confidence) === 'high' || (['medium', 'medium-low', 'low-medium'].includes(confOf(e.email_pattern_confidence)) && v && v.email_pattern_verified === true))) {
      const g = guessEmail(patternOf(e.email_pattern), ct.name, e.website); if (g) { email = g; email_status = 'pattern_guess'; email_source_url = e.email_pattern_source_url || ''; }
    }
    return {
      name: clean(ct.name), title: clean(ct.title), role_type: ct.role_type || 'team_member',
      linkedin_url: /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\//i.test(ct.linkedin_url || '') ? ct.linkedin_url.split('?')[0] : '',
      email, email_status, email_source_url,
      evidence_url: isHttp(ct.evidence_url) ? ct.evidence_url : '',
      verified: !!(vc && vc.verified === true),
      why_them: clean(ct.why_them || (vc && vc.note) || ''),
    };
  }).map((ct) => {
    // Researcher notes sometimes land in the name ("Jane Doe (née Smith)"): keep the name clean, move the note.
    const m = ct.name.match(/^([^()]+?)\s*\(([^)]*)\)\s*$/);
    if (!m) return ct;
    if (/real name not shown|handle only|github handle/i.test(m[2]) && !/\s/.test(m[1].trim())) return null;   // a handle, not a person's name
    return { ...ct, name: m[1].trim(), why_them: clean(`(${m[2]}) ${ct.why_them}`) };
  }).filter((ct) => ct && ct.name)
    // Best contact first (it becomes the default recipient): verified, then role, then has LinkedIn, then has email.
    .map((ct, i) => ({ ct, i }))
    .sort((a, b) => {
      const ROLE = { hiring_manager: 0, fde_lead: 1, recruiter: 2, founder: 3, team_member: 4 };
      const core = (x) => (['hiring_manager', 'fde_lead', 'recruiter'].includes(x.ct.role_type) ? 0 : 1);
      const k = (x) => [core(x), x.ct.verified ? 0 : 1, ROLE[x.ct.role_type] ?? 5, x.ct.linkedin_url ? 0 : 1, x.ct.email ? 0 : 1, x.i];
      const ka = k(a), kb = k(b); for (let j = 0; j < ka.length; j++) if (ka[j] !== kb[j]) return ka[j] - kb[j]; return 0;
    })
    .map((x) => x.ct);
  // careers inbox: keep only when published (verifier confirmed, or enrichment cites a source and verifier did not refute)
  let careers_email = '', careers_src = '';
  if (e && isEmail(e.careers_email)) {
    const ve = v && v.emails ? v.emails.find((x) => x.email && x.email.toLowerCase() === e.careers_email.toLowerCase()) : null;
    if (ve ? ve.verified_public : isHttp(e.careers_email_source_url)) { careers_email = e.careers_email; careers_src = (ve && ve.source_url) || e.careers_email_source_url || ''; }
  }
  if (!careers_email && v && Array.isArray(v.emails)) {
    const alt = v.emails.find((x) => x.verified_public === true && isEmail(x.email) && RECRUIT.test(x.email));
    if (alt) { careers_email = alt.email; careers_src = alt.source_url || ''; }
  }
  const d = drafts.get(c.company);
  const dd = d && d.draft; const cr = d && d.critique;
  const finalDrafts = cr && cr.drafts && cr.drafts.email_body ? cr.drafts : (dd && dd.drafts);
  let score = dd ? dd.score : null;
  if (cr && typeof cr.score_adjustment === 'number') score = Math.max(1, Math.min(10, score + cr.score_adjustment));
  const rec = {
    id: slug(`${c.company} ${role.role_title}`),
    company: c.company,
    company_url: e && isHttp(e.website) ? e.website : '',
    linkedin_company_url: e && isHttp(e.linkedin_company_url) ? e.linkedin_company_url : '',
    hq: clean(e && e.hq), size_text: clean(e && e.size_text), what_they_do: clean(e && e.what_they_do), fde_team_context: clean(e && e.fde_team_context),
    role_title: clean(role.role_title), location: clean(role.location),
    region: (dd && dd.region) || 'Other', remote_policy: (dd && dd.remote_policy) || (role.remote_policy || 'unknown'),
    job_url, posted_or_seen: clean(role.posted_or_seen), employment_type: clean(role.employment_type), salary_text: clean(role.salary_text),
    summary: clean(role.summary), why_fde: clean(role.why_fde),
    other_roles: c.roles.slice(1, 6).map((r) => ({ role_title: clean(r.role_title), location: clean(r.location), job_url: publicUrl(r.job_url) })),
    score, rationale: clean(dd && dd.rationale), suggested_contact: clean(dd && dd.suggested_contact), outreach_angle: clean(dd && dd.outreach_angle), fit_notes: clean(dd && dd.fit_notes),
    company_type: clean(dd && dd.company_type), tags: (dd && dd.tags) || [],
    careers_url: e && isHttp(e.careers_url) ? e.careers_url : '', careers_email, careers_email_source_url: careers_email && isHttp(careers_src) ? careers_src : '',
    email_pattern: e ? patternOf(e.email_pattern) : '', email_pattern_confidence: e ? confOf(e.email_pattern_confidence) : '', email_pattern_source_url: e && isHttp(e.email_pattern_source_url) ? e.email_pattern_source_url : '',
    contacts,
    linkedin_people_search_url: e && isHttp(e.linkedin_people_search_url) ? e.linkedin_people_search_url : '',
    drafts: finalDrafts || null,
    verification: { job_status: jobStatus(v), job_url_live: ['live_fetched', 'listed_recently'].includes(jobStatus(v)) || (!!v && v.job_url_live === true && !v.job_status), role_still_fde: !v || v.role_still_fde !== false, overall_confidence: (v && v.overall_confidence) || 'low', issues: v ? tidyIssue(v.issues) : 'Not independently re-checked; treat contacts and job status as unverified.', checked: !!v },
    sources: [...new Set([role.source_url, role.job_url, ...(e && e.notes ? [] : [])].filter(isHttp))],
    last_verified: TODAY,
    _alt: job_url !== role.job_url,
    _enrichment: stage === 'dossier' ? e : undefined,
    _verification: stage === 'dossier' ? v : undefined,
    _roles: stage === 'dossier' ? c.roles : undefined,
  };
  out.push(rec);
}
if (stage === 'dossier') {
  writeFileSync(outFile, JSON.stringify({ companies: out }, null, 0));
  console.log(`dossier: ${out.length} companies`);
} else {
  const why = (o) => !o.drafts ? 'no drafts' : o.score == null ? 'no score' : !o.verification.role_still_fde ? 'not an FDE role' : o.verification.job_status === 'closed' ? 'posting closed' : '';
  const kept = out.filter((o) => !why(o));
  const dropped = out.filter((o) => why(o)).map((o) => `${o.company} (${why(o)})`);
  // Reconcile layer: a reviewer re-read each record against its verification and changed only what it contradicted.
  const reconcile = new Map();
  for (const run of readOutputs('reconcile-')) for (const r of (run.results || [])) reconcile.set(r.company, r);
  let reconciled = 0;
  for (const o of kept) {
    const r = reconcile.get(o.company); if (!r || !r.changed) continue;
    reconciled++;
    if (Number.isInteger(r.score) && r.score >= 1 && r.score <= 10) o.score = r.score;
    if (['UK', 'Europe', 'Remote', 'US', 'Other'].includes(r.region)) o.region = r.region;
    if (['remote', 'hybrid', 'onsite', 'unknown'].includes(r.remote_policy)) o.remote_policy = r.remote_policy;
    if (r.rationale) o.rationale = clean(r.rationale);
    if (r.fit_notes) o.fit_notes = clean(r.fit_notes);
    if (r.drafts_changed && r.drafts && r.drafts.email_body && r.drafts.linkedin_note) o.drafts = r.drafts;
  }
  if (reconcile.size) console.log(`reconcile: ${reconciled} records changed of ${reconcile.size} reviewed`);
  // Plain-language layer: reader-facing "why it fits you" and "watch out for", rewritten from the analyst notes.
  const plainText = new Map();
  for (const run of readOutputs('plain-')) for (const r of (run.results || [])) plainText.set(r.company, r);
  for (const o of kept) {
    const r = plainText.get(o.company); if (!r) continue;
    if (typeof r.fit_summary === 'string' && r.fit_summary.trim()) o.fit_summary = clean(r.fit_summary);
    if (Array.isArray(r.watch_outs)) o.watch_outs = r.watch_outs.map(clean).filter(Boolean).slice(0, 3);
  }
  if (plainText.size) console.log(`plain language: ${kept.filter((o) => o.fit_summary).length} of ${kept.length} records`);
  // Reviewed manual overrides (exact find/replace on a draft field); fail loudly if an anchor no longer matches.
  let overrides = []; try { overrides = JSON.parse(readFileSync(join(SP, 'overrides.json'), 'utf8')); } catch (err) { overrides = []; }
  for (const ov of overrides) {
    const o = kept.find((x) => x.company === ov.company);
    if (!o || !o.drafts || typeof o.drafts[ov.field] !== 'string' || !o.drafts[ov.field].includes(ov.find)) { console.error(`override did not apply: ${ov.company}.${ov.field}: ${ov.find}`); process.exitCode = 1; continue; }
    o.drafts[ov.field] = o.drafts[ov.field].replace(ov.find, ov.replace);
  }
  // QA on drafts: filled note length, placeholders, word counts, banned style
  const ALLOWED = new Set(['first_name', 'company', 'role', 'my_name', 'my_first_name', 'my_linkedin', 'my_cv', 'signature']);
  const fillNote = (t, o) => t.replace(/\{\{\s*first_name\s*\}\}/g, 'Jonathan').replace(/\{\{\s*company\s*\}\}/g, o.company).replace(/\{\{\s*role\s*\}\}/g, o.role_title).replace(/\{\{\s*my_first_name\s*\}\}/g, 'Hammad').replace(/\{\{\s*my_name\s*\}\}/g, 'Hammad Rehman');
  const qa = [];
  for (const o of kept) {
    const d = o.drafts; const orig = (drafts.get(o.company) || {}).draft;
    if (fillNote(d.linkedin_note, o).length > 295 && orig && orig.drafts && fillNote(orig.drafts.linkedin_note, o).length <= 295) d.linkedin_note = orig.drafts.linkedin_note;
    if (fillNote(d.linkedin_note, o).length > 295) { const cut = d.linkedin_note.slice(0, 280); const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? ')); d.linkedin_note = end > 120 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '.'; qa.push(`${o.company}: note trimmed`); }
    for (const [k, t] of Object.entries(d)) {
      const bad = [...t.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).filter((x) => !ALLOWED.has(x));
      if (bad.length) qa.push(`${o.company}.${k}: unknown placeholders ${bad.join(',')}`);
      if (/\u2014/.test(t)) qa.push(`${o.company}.${k}: em-dash`);
      if (/!/.test(t)) qa.push(`${o.company}.${k}: exclamation`);
      if (/\b(passionate|leverage|synergy|excited)\b/i.test(t)) qa.push(`${o.company}.${k}: buzzword`);
      for (const ct of o.contacts) if (ct.name && ct.name.split(' ').length > 1 && t.includes(ct.name)) qa.push(`${o.company}.${k}: hard-coded contact name ${ct.name}`);
    }
    for (const t of [o.fit_summary || '', ...(o.watch_outs || [])]) {
      if (/\u2014/.test(t)) qa.push(`${o.company}.plain: em-dash`);
      if (/\b(req|reqs|JD|ATS|crawler|aggregator|snippet)\b/.test(t) || /\b20\d\d-\d\d-\d\d\b/.test(t)) qa.push(`${o.company}.plain: jargon or ISO date: ${t.slice(0, 60)}`);
      const namesContact = o.contacts.some((ct) => ct.name && t.includes(ct.name.split(' ')[0]));
      if (/\b(he|his|him)\b/i.test(t) && !namesContact) qa.push(`${o.company}.plain: third person: ${t.slice(0, 60)}`);
    }
    if (o.fit_summary && o.fit_summary.length > 260) qa.push(`${o.company}.plain: fit_summary ${o.fit_summary.length} chars`);
    const words = d.email_body.split(/\s+/).filter(Boolean).length; if (words < 100 || words > 190) qa.push(`${o.company}: email ${words} words`);
    if (!/\{\{\s*signature\s*\}\}\s*$/.test(d.email_body)) qa.push(`${o.company}: email does not end with {{signature}}`);
    if (!/\{\{\s*first_name\s*\}\}/.test(d.email_body)) qa.push(`${o.company}: email greeting lacks {{first_name}}`);
    if (d.email_subject.length > 80) qa.push(`${o.company}: subject ${d.email_subject.length} chars`);
    delete o._alt;
  }
  writeFileSync(join(SP, 'qa-report.txt'), qa.join('\n') + '\n');
  console.log(`QA: ${qa.length} issues (see qa-report.txt)`);
  kept.forEach((o) => { delete o._enrichment; delete o._verification; delete o._roles; });
  writeFileSync(outFile, JSON.stringify({ meta: { generated_at: new Date().toISOString(), target_role: 'Forward Deployed AI Engineer', candidate_location: 'London, UK', companies_researched: partial.distinctCompanies, raw_roles_found: partial.rawRoleCount }, opportunities: kept }, null, 2));
  console.log(`final: ${kept.length} opportunities; dropped: ${dropped.join(', ') || 'none'}; personal inboxes excluded: ${personalDropped}`);
}
