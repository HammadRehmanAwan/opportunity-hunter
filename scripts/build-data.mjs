#!/usr/bin/env node
// Validates data/opportunities.json and builds data/opportunities.js (with data/profile.json) so the page
// works when opened straight from disk (file://) as well as on GitHub Pages / Netlify.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = JSON.parse(readFileSync(join(root, 'data/opportunities.json'), 'utf8'));
const profile = JSON.parse(readFileSync(join(root, 'data/profile.json'), 'utf8'));

const REQUIRED = ['id', 'company', 'role_title', 'job_url', 'score', 'region'];
const REGIONS = new Set(['UK', 'Europe', 'Remote', 'US', 'Other']);
const REMOTE = new Set(['remote', 'hybrid', 'onsite', 'unknown']);
const EMAIL_STATUS = { verified_public: 'verified_public', pattern_guess: 'pattern_guess', published: 'verified_public', guess: 'pattern_guess' };
const URL_FIELDS = ['job_url', 'company_url', 'careers_url', 'linkedin_company_url', 'linkedin_people_search_url', 'careers_email_source_url', 'email_pattern_source_url'];
const isHttp = (u) => /^https?:\/\//i.test(u);
const isEmail = (e) => /^[^\s@,;:<>?&"'()[\]\\]+@[^\s@,;:<>?&"'()[\]\\/]+\.[a-z]{2,}$/i.test(e);
const errors = [];
const warnings = [];
const seen = new Set();

if (!Array.isArray(src.opportunities)) { console.error('data/opportunities.json: "opportunities" must be an array'); process.exit(1); }
src.opportunities.forEach((o, i) => {
  const who = `#${i} ${o && o.company ? o.company : '?'}`;
  if (!o || typeof o !== 'object') { errors.push(`${who}: not an object`); return; }
  REQUIRED.forEach((k) => { if (o[k] === undefined || o[k] === null || o[k] === '') errors.push(`${who}: missing ${k}`); });
  if (o.id !== undefined) { if (!/^[a-z0-9][a-z0-9-]*$/.test(String(o.id))) errors.push(`${who}: id must match /^[a-z0-9][a-z0-9-]*$/`); if (seen.has(o.id)) errors.push(`${who}: duplicate id ${o.id}`); seen.add(o.id); }
  if (!REGIONS.has(o.region)) errors.push(`${who}: region must be one of ${[...REGIONS].join('|')}`);
  if (o.remote_policy !== undefined) { const r = String(o.remote_policy).toLowerCase().replace(/[^a-z]/g, ''); if (r === 'onsite' || r === 'remote' || r === 'hybrid' || r === 'unknown') o.remote_policy = r; else errors.push(`${who}: remote_policy must be remote|hybrid|onsite|unknown`); }
  if (typeof o.score !== 'number' || o.score < 1 || o.score > 10) errors.push(`${who}: score must be a number 1-10`);
  URL_FIELDS.forEach((k) => { if (o[k] && !isHttp(o[k])) errors.push(`${who}: ${k} must start with http(s)://`); });
  if (o.careers_email && !isEmail(o.careers_email)) errors.push(`${who}: careers_email is not an email address`);
  if (o.verification && typeof o.verification.job_url_live !== 'boolean') errors.push(`${who}: verification.job_url_live must be true/false`);
  if (o.verification && o.verification.job_status !== undefined && !['live_fetched', 'listed_recently', 'unconfirmed', 'closed'].includes(o.verification.job_status)) errors.push(`${who}: verification.job_status must be live_fetched|listed_recently|unconfirmed|closed`);
  if (o.contacts !== undefined && !Array.isArray(o.contacts)) errors.push(`${who}: contacts must be an array`);
  (Array.isArray(o.contacts) ? o.contacts : []).forEach((c, j) => {
    const cw = `${who} contact ${j} (${c && c.name ? c.name : '?'})`;
    if (!c || typeof c !== 'object' || !String(c.name || '').trim()) { errors.push(`${cw}: missing name`); return; }
    if (c.linkedin_url && !/^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\//i.test(c.linkedin_url)) errors.push(`${cw}: linkedin_url is not a profile URL`);
    ['evidence_url', 'email_source_url'].forEach((k) => { if (c[k] && !isHttp(c[k])) errors.push(`${cw}: ${k} must start with http(s)://`); });
    if (c.email) {
      if (!isEmail(c.email)) errors.push(`${cw}: email is not an email address`);
      if (EMAIL_STATUS[c.email_status]) c.email_status = EMAIL_STATUS[c.email_status]; else errors.push(`${cw}: email needs email_status verified_public|pattern_guess`);
    }
    if (c.verified !== undefined && typeof c.verified !== 'boolean') errors.push(`${cw}: verified must be true/false`);
  });
  if (o.fit_summary !== undefined && typeof o.fit_summary !== 'string') errors.push(`${who}: fit_summary must be text`);
  if (o.watch_outs !== undefined && !(Array.isArray(o.watch_outs) && o.watch_outs.every((w) => typeof w === 'string'))) errors.push(`${who}: watch_outs must be a list of text`);
  const d = o.drafts || {};
  ['email_subject', 'email_body', 'linkedin_note', 'linkedin_inmail'].forEach((k) => { if (!d[k]) errors.push(`${who}: missing draft ${k}`); });
  if (d.linkedin_note) {
    const filled = d.linkedin_note.replace(/\{\{\s*first_name\s*\}\}/g, 'Jonathan').replace(/\{\{\s*company\s*\}\}/g, o.company || '').replace(/\{\{\s*role\s*\}\}/g, o.role_title || '').replace(/\{\{\s*my_first_name\s*\}\}/g, profile.name ? profile.name.split(' ')[0] : 'Hammad').replace(/\{\{\s*my_name\s*\}\}/g, profile.name || 'Hammad Rehman');
    if (filled.length > 300) errors.push(`${who}: linkedin_note is ${filled.length} chars once filled (max 300)`);
    else if (filled.length > 280) warnings.push(`${who}: linkedin_note is ${filled.length} chars once filled (aim for <= 280)`);
  }
  if (d.email_subject && d.email_subject.length > 90) warnings.push(`${who}: email_subject is ${d.email_subject.length} chars (aim for <= 70)`);
});
// The CV link goes into every draft through {{my_cv}}. retired_cv_urls lists links it used to be;
// the page shows the current cv_url wherever saved details or edited messages still hold one.
if (profile.cv_url && !isHttp(profile.cv_url)) errors.push('data/profile.json: cv_url must be an http(s) link');
if (profile.retired_cv_urls !== undefined) {
  if (!Array.isArray(profile.retired_cv_urls) || !profile.retired_cv_urls.every((u) => typeof u === 'string' && isHttp(u))) errors.push('data/profile.json: retired_cv_urls must be a list of http(s) links');
  else profile.retired_cv_urls.forEach((u) => {
    if (!isHttp(profile.cv_url)) errors.push('data/profile.json: retired_cv_urls needs a cv_url to show instead');
    else if (profile.cv_url.includes(u)) errors.push(`data/profile.json: retired link ${u} is part of cv_url`);
    if (String(profile.signature || '').includes(u)) errors.push(`data/profile.json: signature still has the retired link ${u}`);
    src.opportunities.forEach((o) => Object.entries(o.drafts || {}).forEach(([k, t]) => { if (String(t).includes(u)) errors.push(`${o.id}: ${k} still has the retired link ${u}; use {{my_cv}}`); }));
  });
}
if (warnings.length) console.warn('Warnings:\n  ' + warnings.join('\n  '));
if (errors.length) { console.error('Data validation failed:\n  ' + errors.join('\n  ')); process.exit(1); }

const out = `// GENERATED by scripts/build-data.mjs — edit data/opportunities.json and rebuild.\n` +
  `window.OH_META = ${JSON.stringify(src.meta || {})};\n` +
  `window.OH_PROFILE = ${JSON.stringify(profile)};\n` +
  `window.OH_DATA = ${JSON.stringify(src.opportunities)};\n`;
writeFileSync(join(root, 'data/opportunities.js'), out);
const n = src.opportunities.length;
const c = src.opportunities.reduce((a, o) => a + (Array.isArray(o.contacts) ? o.contacts.length : 0), 0);
console.log(`Wrote data/opportunities.js: ${n} opportunities, ${c} contacts`);
