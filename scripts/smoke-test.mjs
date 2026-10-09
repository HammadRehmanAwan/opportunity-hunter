#!/usr/bin/env node
// Headless smoke test: serves the folder, loads the page in Chromium, and exercises the one-click actions.
// Usage: node scripts/smoke-test.mjs [--fixture]   (--fixture uses scripts/fixture-data.js instead of data/opportunities.js)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const useFixture = process.argv.includes('--fixture');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

const rootDir = root.endsWith(sep) ? root : root + sep;
const server = createServer(async (req, res) => {
  let p; try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); res.end('bad path'); return; }
  if (p === '/') p = '/index.html';
  if (useFixture && p === '/data/opportunities.js') p = '/scripts/fixture-data.js';
  const file = normalize(join(root, p));
  if (!file.startsWith(rootDir) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end('nope'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(await readFile(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/`;

let chromium;
try { ({ chromium } = await import('playwright')); }
catch (e) { try { ({ chromium } = await import('playwright-core')); } catch (e2) { console.error('playwright not installed: npm i -D playwright'); process.exit(2); } }

const launch = { headless: true };
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
page.on('requestfailed', (r) => { if (r.url().startsWith(base)) errors.push(`request failed: ${r.url()} ${r.failure()?.errorText}`); });
await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); else console.log('  ok  ' + msg); };

// The send and LinkedIn actions are real links: record the href the app set (raw, before URL
// parsing tidies it) and keep the test page in place.
const recordLinks = () => {
  window.__nav = [];
  document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a.act-send, a.act-linkedin'); if (a) { e.preventDefault(); window.__nav.push(a.getAttribute('href')); } }, true);
};
await page.addInitScript(recordLinks);
await page.goto(base, { waitUntil: 'networkidle' });
const total = await page.locator('.card').count();
console.log(`Loaded ${base} with ${total} opportunities rendered`);
if (!total) { console.error('No opportunities rendered. Build the data (node scripts/build-data.mjs) or run with --fixture.'); await browser.close(); server.close(); process.exit(1); }
const dataLen = await page.evaluate(() => (window.OH_DATA || []).length);
check(dataLen === 0 || dataLen === total, 'every opportunity in the data renders a card (low scores included)');
check((await page.locator('.score.s-low').count()) >= (dataLen ? 1 : 0), 'a low-score card renders with the s-low badge');
check((await page.locator('#stages .stage').count()) === 7, 'seven progress stages');
check((await page.locator('#stages .stage[data-stage="new"] .n').innerText()) === String(total), 'every role starts as Not contacted');
check(await page.locator('.card .details').first().isHidden(), 'cards start collapsed (details hidden)');
check(await page.locator('.card .composer').first().isHidden(), 'cards start collapsed (composer hidden)');
check(/Write to|Write a message/.test(await page.locator('.card .btn-write').first().innerText()), 'each card offers a Write button');

// Region chips filter and toggle aria-pressed
await page.click('#regions .chip[data-region="UK"]');
const ukCount = await page.locator('.card').count();
check(ukCount > 0 && ukCount <= total, `London & UK chip filters (${ukCount})`);
check((await page.getAttribute('#regions .chip[data-region="UK"]', 'aria-pressed')) === 'true', 'active region chip is pressed');
await page.click('#regions .chip[data-region="any"]');
check((await page.locator('.card').count()) === total, 'Everywhere chip restores all');

// Details toggle
const first = page.locator('.card').first();
await first.locator('.btn-details').click();
check(await first.locator('.details').isVisible(), 'Details & people opens the details');
check((await first.locator('.btn-details').getAttribute('aria-expanded')) === 'true', 'details button reports expanded');
await first.locator('.btn-details').click();
check(await first.locator('.details').isHidden(), 'Details & people closes again');

// Filters
await page.fill('#f-q', 'zzzz-no-match');
check((await page.locator('.card').count()) === 0, 'search filters everything out');
await page.fill('#f-q', '');
check((await page.locator('.card').count()) === total, 'clearing search restores all');
await page.click('#btn-more');
check(await page.locator('#more-filters').isVisible(), 'More filters opens the extra filters');
await page.selectOption('#f-status', 'contacted');
check((await page.locator('.card').count()) === 0, 'no contacted rows at start');
await page.selectOption('#f-status', 'any');
await page.click('#btn-more');

// Outreach on the first card
const card = page.locator('.card').first();
const company = await card.locator('.company').innerText();
await card.locator('.btn-write').click();
check(await card.locator('.composer').isVisible(), 'Write button opens the message panel');
const subject = await card.locator('.d-subject').inputValue();
const body = await card.locator('.d-email').inputValue();
check(subject.length > 0 && body.length > 0, `drafts present for ${company}`);
check(!/\{\{\w+\}\}/.test(subject + body), 'no unfilled {{placeholders}} in email draft');
const note = await card.locator('.d-note').inputValue();
check(note.length > 0 && note.length <= 300, `LinkedIn note within 300 chars (${note.length})`);

// Send email → the link the app built (recorded above) carries the subject and body.
await card.locator('.act-send').click();
const nav = await page.evaluate(() => window.__nav);
check(nav.length === 1 && /^(mailto:|https:\/\/mail\.google\.com\/|https:\/\/outlook\.office\.com\/)/.test(nav[0]) && /(subject|su)=/.test(nav[0]) && /body=/.test(nav[0]), 'Send email builds a mail link with subject and body');
check(!/[\r\n]/.test(nav[0]) && !nav[0].includes('%0A%0D'), 'mail link has no raw line breaks in the URL');
check(/body=[^&]*%0A/.test(nav[0]), 'mail link keeps the line breaks of the message, encoded');
check((await card.locator('.status').inputValue()) === 'contacted', 'sending marks the opportunity Contacted');

// LinkedIn one-click: copies text and opens the profile
await card.locator('.tab[data-tab="note"]').click();
await card.locator('.act-linkedin[data-kind="note"]').click();
await page.waitForFunction(() => window.__nav.length >= 2, null, { timeout: 5000 }).catch(() => {});
const nav2 = await page.evaluate(() => window.__nav);
check(nav2.length === 2 && /^https:\/\/(www\.)?linkedin\.com\/(in|pub|search)\//.test(nav2[1]), "LinkedIn button opens the contact's profile or a people search, not the placeholder");
const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
check(clip === note, 'LinkedIn button copied the note to the clipboard');

// Edited drafts are per recipient: editing under one contact must not leak into another recipient's draft
await card.locator('.tab[data-tab="email"]').click();
const bodyBefore = await card.locator('.d-email').inputValue();
await card.locator('.d-email').fill(bodyBefore + ' PS edited');
const pickOptions = await card.locator('.contact-pick option').count();
if (pickOptions > 1) {
  await card.locator('.contact-pick').selectOption({ index: 1 });
  const bodyOther = await card.locator('.d-email').inputValue();
  check(!bodyOther.includes('PS edited'), 'switching recipient falls back to the template for that recipient');
  await card.locator('.contact-pick').selectOption({ index: 0 });
  check((await card.locator('.d-email').inputValue()).includes('PS edited'), 'switching back restores that recipient\'s edit');
}
await card.locator('.d-subject').fill('Edited subject');
await card.locator('.notes').fill('Spoke on Tuesday');
await page.reload({ waitUntil: 'networkidle' });
const card2 = page.locator('.card').first();
await card2.locator('.btn-write').click();
check((await card2.locator('.d-subject').inputValue()) === 'Edited subject', 'edited subject survives reload');
check((await card2.locator('.notes').inputValue()) === 'Spoke on Tuesday', 'notes survive reload');
check((await card2.locator('.status').inputValue()) === 'contacted', 'status survives reload');
await card2.locator('.act-reset[data-field="email"]').click();
check((await card2.locator('.d-subject').inputValue()) === subject, 'reset restores the original subject');

// Profile drawer: focus moves in, Escape closes and restores focus
await page.click('#btn-profile');
check(await page.evaluate(() => document.activeElement && document.activeElement.name === 'name'), 'drawer moves focus to the first field');
await page.keyboard.press('Escape');
check(await page.evaluate(() => document.getElementById('drawer').hidden), 'Escape closes the drawer');
check(await page.evaluate(() => document.activeElement && document.activeElement.id === 'btn-profile'), 'closing restores focus to the opener');
await page.click('#btn-profile');
await page.fill('#profile-form input[name="name"]', 'Test Person');
await page.click('#profile-form button[type="submit"]');
const card3 = page.locator('.card').first();
await card3.locator('.btn-write').click();
const inmail3 = await card3.locator('.d-inmail').inputValue();
check(/Test Person/.test(inmail3), 'profile name flows into the drafts ({{my_name}})');

// Theme toggle + CSV export
await page.click('#btn-theme');
check(['dark', 'light'].includes(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))), 'theme toggle sets data-theme');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export')]);
const csv = await (await dl.createReadStream()).toArray().then((b) => Buffer.concat(b).toString());
check(csv.split('\n').length > 1 && csv.startsWith('company,role,'), 'CSV export has a header and rows');
check(!/(^|,)[=+\-@]/m.test(csv.split('\n').slice(1).join('\n')), 'CSV cells never start with a formula character');
// Injection attempt in data must be escaped, not executed
const xss = await page.evaluate(() => document.querySelector('#xss-canary') !== null);
check(!xss, 'no injected element from data reached the DOM');

// Mobile viewport: no horizontal scroll
await page.setViewportSize({ width: 390, height: 800 });
await page.reload({ waitUntil: 'networkidle' });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (overflow > 0) { const wide = await page.evaluate(() => Array.from(document.querySelectorAll('body *')).filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 8).map((e) => `${e.tagName.toLowerCase()}${e.className ? '.' + String(e.className).split(' ')[0] : ''}@${Math.round(e.getBoundingClientRect().right)}`)); console.log('  overflowing: ' + wide.join(', ')); }
check(overflow <= 0, `no horizontal overflow at 390px (delta ${overflow})`);
await page.locator('.card').first().locator('.btn-write').click();
const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check(overflow2 <= 0, `no horizontal overflow at 390px with outreach open (delta ${overflow2})`);

// Every link is http(s), mailto or an anchor
const badLinks = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map((a) => a.getAttribute('href')).filter((h) => !/^(https?:|mailto:|#)/.test(h)));
check(badLinks.length === 0, `all links are http(s)/mailto/anchor (${badLinks.join(', ') || 'none bad'})`);

await page.setViewportSize({ width: 1280, height: 900 });
await page.reload({ waitUntil: 'networkidle' });

// LinkedIn follows the picked contact: their own profile when they have one (at a non-default pick),
// a people search when they don't.
await page.evaluate(() => document.querySelector('#btn-clear').click());
const liCase = await page.evaluate(() => {
  const has = (c) => /^https?:\/\//i.test(c.linkedin_url || '');
  for (const o of window.OH_DATA || []) {
    const cs = o.contacts || []; const i = cs.findIndex((c, k) => k > 0 && has(c)); const j = cs.findIndex((c) => !has(c));
    if (i > 0 && j >= 0) return { id: o.id, i, j, url: cs[i].linkedin_url, search: /^https?:\/\//i.test(o.linkedin_people_search_url || '') ? o.linkedin_people_search_url : null };
  }
  return null;
});
check(!!liCase, '(setup) a role with a contact who has a LinkedIn profile at a non-default pick');
if (liCase) {
  const lc = page.locator(`.card[data-id="${liCase.id}"]`);
  if (await lc.locator('.composer').isHidden()) await lc.locator('.btn-write').click();
  await lc.locator('.tab[data-tab="note"]').click();
  await lc.locator('.contact-pick').selectOption(String(liCase.i));
  await lc.locator('.act-linkedin[data-kind="note"]').click();
  let navLi = await page.evaluate(() => window.__nav);
  check(navLi[navLi.length - 1] === liCase.url, "LinkedIn button opens the picked contact's own profile");
  await lc.locator('.contact-pick').selectOption(String(liCase.j));
  await lc.locator('.act-linkedin[data-kind="note"]').click();
  navLi = await page.evaluate(() => window.__nav);
  const last = navLi[navLi.length - 1];
  check(liCase.search ? last === liCase.search : /^https:\/\/www\.linkedin\.com\/search\/results\/people\//.test(last), 'LinkedIn button opens a people search for a contact without a profile');
}

// Outlook on the web: the link carries the subject and the message with its line breaks.
await page.click('#btn-profile');
await page.locator('#profile-form select[name="mail_client"]').selectOption('outlook');
await page.click('#profile-form button[type="submit"]');
const oc = page.locator('.card').first();
if (await oc.locator('.composer').isHidden()) await oc.locator('.btn-write').click();
const outlookHref = await oc.locator('.act-send').getAttribute('href');
check(/^https:\/\/outlook\.office\.com\/mail\/deeplink\/compose\?/.test(outlookHref) && /[?&]subject=[^&]+/.test(outlookHref) && /[?&]body=[^&]*%0A/.test(outlookHref), 'Outlook link carries the subject and the message line breaks');

// Standalone, "Clear everything" asks with confirm()
await page.locator('.card').first().locator('.status').selectOption('shortlisted');
await page.click('#btn-profile');
const notContacted = async (p = page) => Number(await p.locator('#stages .stage[data-stage="new"] .n').innerText());
page.once('dialog', (d) => d.dismiss());
await page.click('#btn-wipe');
check((await notContacted()) < total, 'Clear everything: answering Cancel clears nothing');
page.once('dialog', (d) => d.accept());
await page.click('#btn-wipe');
check((await notContacted()) === total, 'Clear everything: answering OK clears progress');

// ---------- Inside the claude.ai artifact viewer ----------
// A fake window.claude. Its account store lives in a test-only localStorage key and is read and
// written on every call, so it survives reloads and is shared by tabs like the real one.
// Test-only switches, also in localStorage: __uid picks the account, __slow delays claude.use (ms),
// __nodb hides the db, __nouser hides who is signed in, __failGet makes reading the account fail,
// __failGetOnce makes only the next read fail, __holdGet holds a read's answer (taken when asked,
// or with "late" taken when released) until the switch is removed, __can is what user.can('data.write') answers ("true", "false" or
// "throw"), __refuseWrites makes writes fail with invalid_argument, __nodl hides the save prompt.
// window.__failNext makes that many of the next writes fail with "unavailable".
const seedId = await page.evaluate(() => document.querySelectorAll('.card')[1]?.dataset.id);
const vctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await vctx.grantPermissions(['clipboard-read', 'clipboard-write']);
const fakeClaude = (seed) => {
  const KEY = '__fakedb';
  const flag = (k) => localStorage.getItem(k);
  const readAll = () => new Map(JSON.parse(localStorage.getItem(KEY) || '[]'));
  const writeAll = (m) => localStorage.setItem(KEY, JSON.stringify([...m.entries()]));
  if (localStorage.getItem(KEY) == null) writeAll(new Map(seed ? [[`data/users/viewer1/t-${seed}`, { status: 'interviewing', notes: 'seeded', drafts: {}, contact: 0 }]] : []));
  window.__saves = []; window.__failNext = 0;
  const fail = () => {
    if (flag('__refuseWrites')) throw { code: 'invalid_argument', message: 'test refusal' };
    if (window.__failNext > 0) { window.__failNext -= 1; throw { code: 'unavailable', message: 'test outage' }; }
  };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const snap = (p, v) => ({ id: p.split('/').pop(), exists: v !== undefined, data: () => (v === undefined ? undefined : Object.freeze(clone(v))), metadata: { fromCache: false, hasPendingWrites: false } });
  const ref = (p) => ({ id: p.split('/').pop(), path: p, get: async () => snap(p, readAll().get(p)),
    set: async (d) => { fail(); const m = readAll(); m.set(p, clone(d)); writeAll(m); },
    delete: async () => { fail(); const m = readAll(); m.delete(p); writeAll(m); } });
  const db = { doc: ref, collection: (c) => ({ path: c, doc: (id) => ref(`${c}/${id}`), get: async () => {
    if (flag('__failGet')) throw { code: 'unavailable', message: 'test outage' };
    if (flag('__failGetOnce')) { localStorage.removeItem('__failGetOnce'); throw { code: 'unavailable', message: 'test outage' }; }
    const late = flag('__holdGet') === 'late';
    const take = () => [...readAll().entries()].filter(([p]) => p.startsWith(`${c}/`) && !p.slice(c.length + 1).includes('/')).map(([p, v]) => snap(p, v));
    let docs = late ? null : take();
    while (flag('__holdGet')) await new Promise((r) => { setTimeout(r, 50); });
    if (late) docs = take();
    return { docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false, hasPendingWrites: false }, docChanges: () => [] };
  } }) };
  const uid = flag('__uid') || 'viewer1';
  const caps = {
    db: flag('__nodb') ? null : db,
    user: flag('__nouser') ? null : Object.assign({ id: async () => uid }, flag('__can') ? { can: async () => { if (flag('__can') === 'throw') throw new Error('test'); return flag('__can') === 'true'; } } : {}),
    downloads: flag('__nodl') ? null : { save: async ({ filename, data }) => { window.__saves.push({ filename, data: String(data) }); return { status: 'saved' }; } },
  };
  const slow = Number(flag('__slow') || 0);
  window.claude = Object.freeze({ use: async (n) => { if (slow) await new Promise((r) => { setTimeout(r, slow); }); return caps[n] || null; } });
};
const viewerPage = async () => {
  const p = await vctx.newPage();
  p.on('pageerror', (e) => errors.push(`viewer pageerror: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`viewer console: ${m.text()}`); });
  await p.addInitScript(recordLinks);
  await p.addInitScript(fakeClaude, seedId);
  return p;
};
const vpage = await viewerPage();
const account = (p = vpage) => p.evaluate(() => Object.fromEntries(JSON.parse(localStorage.getItem('__fakedb') || '[]')));
const accountDoc = async (id, uid = 'viewer1') => (await account())[`data/users/${uid}/t-${id}`] || null;
const accountDocs = async (uid = 'viewer1') => Object.keys(await account()).filter((k) => k.startsWith(`data/users/${uid}/`)).length;
const waitAccount = (id, status, uid = 'viewer1', timeout = 5000) => vpage.waitForFunction(([i, s, u]) => Object.fromEntries(JSON.parse(localStorage.getItem('__fakedb') || '[]'))[`data/users/${u}/t-${i}`]?.status === s, [id, status, uid], { timeout }).catch(() => {});
const stageCount = async (k, p = vpage) => Number(await p.locator(`#stages .stage[data-stage="${k}"] .n`).innerText());
const waitReady = (p = vpage) => p.waitForFunction(() => !document.querySelector('#btn-profile').disabled, null, { timeout: 15000 }).catch(() => {});
const savedWhere = (p = vpage) => p.locator('.saved-where').first().textContent();
const statusOf = (id, p = vpage) => p.locator(`.card[data-id="${id}"] .status`).inputValue();
const setStatus = (id, s, p = vpage) => p.locator(`.card[data-id="${id}"] .status`).selectOption(s);
const setFlag = (k, v) => vpage.evaluate(([key, val]) => { if (val == null) localStorage.removeItem(key); else localStorage.setItem(key, val); }, [k, v]);
const reload = async (p = vpage) => { await p.reload({ waitUntil: 'networkidle' }); await waitReady(p); };
const accountProfile = async (uid = 'viewer1') => (await account())[`data/users/${uid}/profile`] || null;
const editAccount = (key, patch) => vpage.evaluate(([k, pt]) => { const m = new Map(JSON.parse(localStorage.getItem('__fakedb'))); if (pt === null) m.delete(k); else m.set(k, Object.assign({}, m.get(k), pt)); localStorage.setItem('__fakedb', JSON.stringify([...m.entries()])); }, [key, patch]);
const ohStorage = () => vpage.evaluate(() => JSON.stringify(Object.keys(localStorage).filter((k) => k.startsWith('oh:')).sort().map((k) => [k, localStorage.getItem(k)])));

await vpage.goto(base, { waitUntil: 'networkidle' });
await waitReady();

// Progress the earlier version kept without an account id is removed, never imported: not even
// into an account that has no copy in this browser yet.
const legacyId = await vpage.evaluate(() => document.querySelectorAll('.card')[2]?.dataset.id);
await vpage.evaluate((id) => { localStorage.setItem('oh:tracker:v1', JSON.stringify({ [id]: { status: 'offer', notes: 'legacy note' } })); localStorage.setItem('oh:profile:v1', JSON.stringify({ name: 'Legacy Person' })); }, legacyId);
await setFlag('__uid', 'viewer4');
await reload();
await vpage.click('#btn-profile');
const legacyName = await vpage.locator('#profile-form input[name="name"]').inputValue();
await vpage.click('#btn-drawer-close');
await vpage.waitForTimeout(1200);
check(!(await vpage.evaluate(() => localStorage.getItem('oh:tracker:v1') || localStorage.getItem('oh:profile:v1'))) && (await statusOf(legacyId)) === 'new' && legacyName !== 'Legacy Person'
  && (await accountDocs('viewer4')) === 0, 'viewer: progress an earlier version left in this browser is removed, not given to the next account');
await setFlag('__uid', null);
await reload();

// Nothing is shown or editable until the account has answered.
await setFlag('__slow', '1500');
await vpage.reload({ waitUntil: 'domcontentloaded' });
await vpage.waitForTimeout(300);
check((await vpage.locator('.card').count()) === 0 && /Loading your saved progress/.test(await vpage.locator('#list').innerText()) && (await vpage.locator('#btn-profile').isDisabled()), 'viewer: roles and Your details wait until saved progress has loaded');
await waitReady();
check((await vpage.locator('.card').count()) === total, 'viewer: the roles appear once the account has answered');
await setFlag('__slow', null);
await reload();

check((await savedWhere()) === 'to your Claude account and this browser', 'viewer: says progress is saved to the Claude account and this browser');
check(!seedId || (await stageCount('interviewing')) === 1, 'viewer: progress saved in the account shows on load');
const vcard = vpage.locator('.card').first();
const vfirstId = await vcard.getAttribute('data-id');
await vcard.locator('.btn-write').click();
const sendHref = await vcard.locator('.act-send').getAttribute('href');
check(/^https:\/\/mail\.google\.com\//.test(sendHref) && (await vcard.locator('.act-send').getAttribute('target')) === '_blank', 'viewer: email opens Gmail in a new tab by default');
check(/[?&]body=[^&]*%0A/.test(sendHref), 'viewer: the Gmail link keeps the line breaks of the message, encoded');
const expectedLi = await vpage.evaluate((id) => {
  const o = window.OH_DATA.find((x) => x.id === id); const pick = document.querySelector(`.card[data-id="${id}"] .contact-pick`).value;
  const c = (o.contacts || [])[Number(pick)];
  return c && /^https?:\/\//i.test(c.linkedin_url || '') ? c.linkedin_url : null;
}, vfirstId);
const liHref = await vcard.locator('.act-linkedin').first().getAttribute('href');
check((await vcard.locator('.act-linkedin').first().getAttribute('target')) === '_blank' && (expectedLi ? liHref === expectedLi : /^https:\/\/www\.linkedin\.com\/search\/results\/people\//.test(liHref)), "viewer: LinkedIn button links to the picked contact's profile, or a people search when there is none");
await vcard.locator('.d-subject').fill('Changed subject line');
check(/Changed%20subject%20line/.test(await vcard.locator('.act-send').getAttribute('href')), 'viewer: editing the subject updates the email link');
await setStatus(vfirstId, 'replied');
await waitAccount(vfirstId, 'replied');
check((await accountDoc(vfirstId))?.status === 'replied', 'viewer: a status change is saved to the account');
await vpage.click('#btn-export');
await vpage.waitForFunction(() => window.__saves.length > 0, null, { timeout: 5000 }).catch(() => {});
const saved = await vpage.evaluate(() => window.__saves[0]);
check(saved && saved.filename === 'opportunity-hunter.csv' && saved.data.startsWith('company,role,'), 'viewer: CSV goes through the save prompt');

const ids = await vpage.evaluate(() => [...document.querySelectorAll('.card')].map((c) => c.dataset.id));
const [, , id3, id4, id5] = ids;
if (id5) {
  // A change that never reached the account (every write failing, then a reload) is kept and
  // uploaded on the next load instead of being replaced by the older account copy.
  await setStatus(id3, 'shortlisted'); await waitAccount(id3, 'shortlisted');
  check((await accountDoc(id3))?.status === 'shortlisted', 'viewer: (setup) the account holds the older status');
  await vpage.evaluate(() => { window.__failNext = 99; });
  await setStatus(id3, 'offer');
  await vpage.waitForTimeout(1200);
  check((await accountDoc(id3))?.status === 'shortlisted', 'viewer: (setup) the account did not get the change while writes fail');
  await reload(); await waitAccount(id3, 'offer');
  check((await statusOf(id3)) === 'offer' && (await accountDoc(id3))?.status === 'offer', 'viewer: a change that missed the account survives a reload and is uploaded');

  // One failed write is retried without another edit.
  await vpage.evaluate(() => { window.__failNext = 1; });
  await setStatus(id4, 'shortlisted');
  await waitAccount(id4, 'shortlisted', 'viewer1', 8000);
  check((await accountDoc(id4))?.status === 'shortlisted', 'viewer: a failed write is retried on its own');

  // Both this browser and another device changed a role: the later edit wins.
  await vpage.evaluate(() => { window.__failNext = 99; });
  await setStatus(id4, 'replied');
  await vpage.waitForTimeout(1200);
  await vpage.evaluate((id) => { const m = new Map(JSON.parse(localStorage.getItem('__fakedb'))); const k = `data/users/viewer1/t-${id}`; m.set(k, Object.assign({}, m.get(k), { status: 'interviewing', u: Date.now() + 60000 })); localStorage.setItem('__fakedb', JSON.stringify([...m.entries()])); }, id4);
  await reload(); await vpage.waitForTimeout(1200);
  check((await statusOf(id4)) === 'interviewing' && (await accountDoc(id4))?.status === 'interviewing', 'viewer: when both sides changed a role, the later edit wins (the account here)');
  await vpage.evaluate(() => { window.__failNext = 99; });
  await setStatus(id4, 'offer');
  await vpage.waitForTimeout(1200);
  await vpage.evaluate((id) => { const m = new Map(JSON.parse(localStorage.getItem('__fakedb'))); const k = `data/users/viewer1/t-${id}`; m.set(k, Object.assign({}, m.get(k), { status: 'contacted', u: Date.now() - 60000 })); localStorage.setItem('__fakedb', JSON.stringify([...m.entries()])); }, id4);
  await reload(); await waitAccount(id4, 'offer');
  check((await statusOf(id4)) === 'offer' && (await accountDoc(id4))?.status === 'offer', 'viewer: when both sides changed a role, the later edit wins (this browser here)');

  // Removed in the account (cleared on another device): this browser's unchanged copy follows.
  await vpage.evaluate((id) => { const m = new Map(JSON.parse(localStorage.getItem('__fakedb'))); m.delete(`data/users/viewer1/t-${id}`); localStorage.setItem('__fakedb', JSON.stringify([...m.entries()])); }, id3);
  await reload(); await vpage.waitForTimeout(1200);
  check((await statusOf(id3)) === 'new' && (await accountDoc(id3)) === null && !(await vpage.evaluate((id) => localStorage.getItem(`oh:u:viewer1:t:${id}`), id3)), 'viewer: progress cleared elsewhere stays cleared');

  // One side removed a role, the other changed it: the change is kept, whichever side made it.
  // (id3 is untouched again here, and "shortlisted" sets no first-contact date, so going back to
  // "Not contacted" really removes it.)
  await setStatus(id3, 'shortlisted'); await waitAccount(id3, 'shortlisted');
  await vpage.evaluate(() => { window.__failNext = 99; });
  await setStatus(id3, 'new');
  await vpage.waitForTimeout(1200);
  check(!(await vpage.evaluate((id) => localStorage.getItem(`oh:u:viewer1:t:${id}`), id3)), '(setup) setting a shortlisted role back to Not contacted removes it here');
  await editAccount(`data/users/viewer1/t-${id3}`, { status: 'offer', u: Date.now() });
  await reload(); await vpage.waitForTimeout(1200);
  check((await statusOf(id3)) === 'offer' && (await accountDoc(id3))?.status === 'offer', 'viewer: a change elsewhere beats a removal here');
  await vpage.evaluate(() => { window.__failNext = 99; });
  await setStatus(id3, 'replied');
  await vpage.waitForTimeout(1200);
  await editAccount(`data/users/viewer1/t-${id3}`, null);
  await reload(); await waitAccount(id3, 'replied');
  check((await statusOf(id3)) === 'replied' && (await accountDoc(id3))?.status === 'replied', 'viewer: a change here beats a removal elsewhere');

  // Two tabs on one account: each shows the other's changes and never overwrites them.
  const tab2 = await viewerPage();
  await tab2.goto(base, { waitUntil: 'networkidle' }); await waitReady(tab2);
  const t2card = tab2.locator(`.card[data-id="${id5}"]`);
  await t2card.locator('.btn-write').click(); await t2card.locator('.tab[data-tab="note"]').click();
  await setStatus(id5, 'offer'); await waitAccount(id5, 'offer');
  await tab2.waitForFunction((id) => document.querySelector(`.card[data-id="${id}"] .status`)?.value === 'offer', id5, { timeout: 5000 }).catch(() => {});
  check((await statusOf(id5, tab2)) === 'offer', "viewer: a second tab shows the first tab's change");
  check((await t2card.locator('.composer').isVisible()) && (await t2card.locator('.tab.active').getAttribute('data-tab')) === 'note', "viewer: the second tab's open message panel and tab stay as they were");
  await setStatus(id3, 'shortlisted', tab2);
  await tab2.waitForTimeout(1500);
  await tab2.close();
  await reload(); await vpage.waitForTimeout(1200);
  check((await statusOf(id5)) === 'offer' && (await accountDoc(id5))?.status === 'offer' && (await statusOf(id3)) === 'shortlisted', "viewer: one tab's save doesn't undo the other tab's change");

  // A tab that is still loading (its account answer was taken before another tab's upload and
  // arrives after it) doesn't write its old copy over that tab's newer change.
  await setFlag('__holdGet', '1');
  const tab3 = await viewerPage();
  await tab3.goto(base, { waitUntil: 'domcontentloaded' });
  await tab3.waitForTimeout(800);
  await setStatus(id5, 'interviewing'); await waitAccount(id5, 'interviewing');
  await vpage.waitForTimeout(300);
  await setFlag('__holdGet', null);
  await waitReady(tab3); await tab3.waitForTimeout(1500);
  check((await statusOf(id5)) === 'interviewing' && (await statusOf(id5, tab3)) === 'interviewing' && (await accountDoc(id5))?.status === 'interviewing', "viewer: a tab that is still loading doesn't undo another tab's change");
  await tab3.close(); await vpage.waitForTimeout(500);
  check((await accountDoc(id5))?.status === 'interviewing', '... not even when it closes');

  // A change made and then undone in one tab while another loads, whose answer still holds the
  // change, stays undone.
  await setFlag('__holdGet', 'late');
  const tab4 = await viewerPage();
  await tab4.goto(base, { waitUntil: 'domcontentloaded' });
  await tab4.waitForTimeout(800);
  await setStatus(id5, 'passed'); await waitAccount(id5, 'passed');
  await vpage.waitForTimeout(300);
  await setStatus(id5, 'interviewing');
  await setFlag('__holdGet', null);
  await waitReady(tab4); await tab4.waitForTimeout(2000);
  check((await statusOf(id5)) === 'interviewing' && (await statusOf(id5, tab4)) === 'interviewing' && (await accountDoc(id5))?.status === 'interviewing', 'viewer: a change undone in one tab while another loads stays undone');
  await tab4.close();
  await setStatus(id5, 'offer'); await waitAccount(id5, 'offer');

  // Another Claude account in the same browser sees nothing of the first account, not even a
  // change the first account hasn't uploaded yet.
  await vpage.evaluate(() => { window.__failNext = 99; });
  await setStatus(id5, 'passed');
  await vpage.waitForTimeout(1200);
  await setFlag('__uid', 'viewer2');
  await reload(); await vpage.waitForTimeout(1200);
  check((await notContacted(vpage)) === total && (await accountDocs('viewer2')) === 0, "viewer: a second account in the same browser doesn't see or copy the first account's progress");
  await setFlag('__uid', null);
  await reload(); await waitAccount(id5, 'passed');
  check((await statusOf(id5)) === 'passed' && (await accountDoc(id5))?.status === 'passed', "viewer: back on the first account, its unsent change is still there and is uploaded");

  // No account at all: progress is kept on the page only, and nothing is written to this browser.
  await setFlag('__nouser', '1');
  await reload();
  const keysBefore = await ohStorage();
  await setStatus(id4, 'offer');
  await vpage.fill('#f-q', 'acme');
  await vpage.click('#btn-profile');
  await vpage.locator('#profile-form input[name="name"]').fill('Memory Person');
  await vpage.click('#profile-form button[type="submit"]');
  await vpage.waitForTimeout(500);
  const keysAfter = await ohStorage();
  await vpage.fill('#f-q', '');
  check(/until you close/.test(await savedWhere()) && keysBefore === keysAfter && !(await vpage.evaluate(() => localStorage.getItem('oh:tracker:v1'))), 'viewer: with no account, nothing is written where another account could read it');
  await setFlag('__nouser', null);

  // Signed in but no db: carry on from this account's own browser copy, and write nothing unkeyed.
  await setFlag('__nodb', '1');
  await reload();
  await setStatus(id4, 'replied');
  await vpage.waitForTimeout(500);
  const unkeyed = await vpage.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('oh:') && !k.startsWith('oh:u:')));
  const keyed = await vpage.evaluate((id) => localStorage.getItem(`oh:u:viewer1:t:${id}`), id4);
  check(/reload the page/.test(await savedWhere()) && unkeyed.length === 0 && /"replied"/.test(keyed || ''), "viewer: without the db, changes go only to this account's own browser copy");
  await setFlag('__nodb', null);
  await reload(); await waitAccount(id4, 'replied');
  check((await accountDoc(id4))?.status === 'replied', 'viewer: and reach the account once the db is back');

  // The host says this viewer may not write: nothing is sent, and the page says so.
  await setFlag('__can', 'false');
  await reload();
  await setStatus(id4, 'shortlisted');
  await vpage.waitForTimeout(1500);
  check((await savedWhere()) === 'in this browser only' && (await accountDoc(id4))?.status === 'replied', 'viewer: when the host says this viewer may not write, nothing is sent and the page says so');
  await setFlag('__can', 'throw');
  await reload();
  check((await savedWhere()) === 'to your Claude account and this browser', 'viewer: when asking may-I-write fails, the page still saves to the account');
  await setFlag('__can', null);
  // Every write refused as not allowed (the host didn't say): saving stops and the page says so.
  await setFlag('__refuseWrites', '1');
  await reload();
  await setStatus(id4, 'contacted');
  await vpage.waitForTimeout(1500);
  check((await savedWhere()) === 'in this browser only' && /isn't allowed/.test(await vpage.locator('#toast').innerText()), 'viewer: when every write is refused, saving to the account stops and the page says so');
  await setFlag('__refuseWrites', null);
  await reload(); await waitAccount(id4, 'contacted');
  check((await accountDoc(id4))?.status === 'contacted', 'viewer: and those changes go out once writing works again');
  // One failed account read is retried.
  await setFlag('__failGetOnce', '1');
  await reload();
  check((await savedWhere()) === 'to your Claude account and this browser', 'viewer: a single failed account read is retried');

  // The account can't be read on a browser that has no copy yet: never treat it as empty.
  await vpage.evaluate(() => { const m = new Map(JSON.parse(localStorage.getItem('__fakedb'))); m.set(`data/users/viewer3/t-${document.querySelector('.card').dataset.id}`, { status: 'interviewing', notes: 'keep me', drafts: {}, contact: 0 }); localStorage.setItem('__fakedb', JSON.stringify([...m.entries()])); });
  await setFlag('__uid', 'viewer3'); await setFlag('__failGet', '1');
  await reload();
  await setStatus(vfirstId, 'contacted');
  await vpage.waitForTimeout(1500);
  check(/until you close/.test(await savedWhere()) && (await accountDoc(vfirstId, 'viewer3'))?.notes === 'keep me', "viewer: when the account can't be read on a new browser, its saved progress is left alone");
  await setFlag('__failGet', null);
  await reload();
  check((await statusOf(vfirstId)) === 'interviewing', 'viewer: once the account answers, its saved progress shows');
  await setFlag('__uid', null);

  // The account can't be read on a browser that has a copy: work from the copy, upload later.
  await setFlag('__failGet', '1');
  await reload();
  check(/reload the page/.test(await savedWhere()) && (await statusOf(id5)) === 'passed', "viewer: when the account can't be read, this browser's copy is shown and the page says to reload");
  await setStatus(id4, 'contacted');
  await vpage.waitForTimeout(500);
  await setFlag('__failGet', null);
  await reload(); await waitAccount(id4, 'contacted');
  check((await accountDoc(id4))?.status === 'contacted', 'viewer: changes made while the account was unreachable are uploaded later');
}

// The search box can name people, so it is never saved with this account's filters.
await vpage.fill('#f-q', 'acme');
await vpage.click('#regions .chip[data-region="UK"]');
const savedFilters = await vpage.evaluate(() => JSON.parse(localStorage.getItem('oh:u:viewer1:f') || 'null'));
check(savedFilters && savedFilters.region === 'UK' && savedFilters.q === '', "viewer: filters are saved for this account, without the search text");
await vpage.fill('#f-q', '');
await vpage.click('#regions .chip[data-region="any"]');

// A filter chosen while the page is still loading is kept and saved, and the other saved filters
// come back with it. Saved "More filters" choices open their panel.
await vpage.selectOption('#f-sort', 'company');
await vpage.click('#btn-more');
await vpage.check('#f-email');
await setFlag('__holdGet', '1'); // the account id is known, the account read is waiting
await vpage.reload({ waitUntil: 'domcontentloaded' });
await vpage.waitForTimeout(800);
await vpage.click('#regions .chip[data-region="Remote"]');
await setFlag('__holdGet', null);
await waitReady();
const fNow = await vpage.evaluate(() => JSON.parse(localStorage.getItem('oh:u:viewer1:f') || '{}'));
check((await vpage.locator('#regions .chip[data-region="Remote"]').getAttribute('aria-pressed')) === 'true' && fNow.region === 'Remote' && fNow.sort === 'company' && fNow.emailOnly === true
  && (await vpage.inputValue('#f-sort')) === 'company', 'viewer: a filter chosen while loading is kept and saved, with the other saved filters');
check(await vpage.locator('#more-filters').isVisible(), 'viewer: saved "More filters" choices open their panel');
await vpage.evaluate(() => document.querySelector('#btn-clear').click());

// No save prompt: the file still downloads the plain way.
await setFlag('__nodl', '1');
await reload();
const [plainDl] = await Promise.all([vpage.waitForEvent('download', { timeout: 6000 }).catch(() => null), vpage.click('#btn-export')]);
check(plainDl && /Download started/.test(await vpage.locator('#toast').innerText()), 'viewer: without the save prompt, the CSV downloads the plain way');
await setFlag('__nodl', null);
await reload();

// Download a backup (through the save prompt) to restore after clearing.
await vpage.click('#btn-profile');
const savesBefore = await vpage.evaluate(() => window.__saves.length);
await vpage.click('#btn-backup');
await vpage.waitForFunction((n) => window.__saves.length > n, savesBefore, { timeout: 5000 }).catch(() => {});
const backup = await vpage.evaluate(() => window.__saves[window.__saves.length - 1]);
check(backup && backup.filename === 'opportunity-hunter-backup.json' && JSON.parse(backup.data).source === 'claude-page', 'viewer: a backup goes through the save prompt');
await vpage.click('#btn-drawer-close');

// Clear everything on the Claude page: a double-click or a held key is not a confirmation; a
// second, separate click is.
await vpage.click('#btn-profile');
const docsBefore = await accountDocs();
await vpage.dblclick('#btn-wipe');
await vpage.waitForTimeout(900);
check(docsBefore > 0 && (await accountDocs()) === docsBefore && (await notContacted(vpage)) < total, 'viewer: double-clicking Clear everything clears nothing');
await vpage.waitForTimeout(8500); // let the confirmation lapse
await vpage.focus('#btn-wipe');
await vpage.keyboard.down('Enter');
await vpage.waitForTimeout(900);
for (let i = 0; i < 3; i += 1) { await vpage.keyboard.down('Enter'); await vpage.waitForTimeout(150); }
await vpage.keyboard.up('Enter');
check((await accountDocs()) === docsBefore && (await notContacted(vpage)) < total, 'viewer: holding Enter on Clear everything clears nothing');
await vpage.waitForTimeout(700);
await vpage.click('#btn-wipe');
await vpage.waitForFunction(() => !JSON.parse(localStorage.getItem('__fakedb') || '[]').some(([k]) => k.startsWith('data/users/viewer1/')), null, { timeout: 5000 }).catch(() => {});
check((await accountDocs()) === 0 && (await notContacted(vpage)) === total, 'viewer: a second click clears everything, including the account copy');

// A crafted backup can't break the page or store junk, and doesn't touch saved details it can't use.
await vpage.locator('#profile-form input[name="name"]').fill('Distinct Name');
await vpage.click('#profile-form button[type="submit"]');
await vpage.waitForFunction(() => /Distinct Name/.test(JSON.stringify(JSON.parse(localStorage.getItem('__fakedb') || '[]'))), null, { timeout: 5000 }).catch(() => {});
await vpage.click('#btn-profile');
const okId = ids[1];
await vpage.locator('#file-restore').setInputFiles({ name: 'evil.json', mimeType: 'application/json', buffer: Buffer.from(`{"profile":{"name":5,"phone":{"x":1}},"tracker":{${JSON.stringify(vfirstId)}:{"status":"<img src=x>","notes":7,"drafts":{"__proto__":{"email_body":"x"},"evil":{"email_body":"x"},"0":{"email_body":9}},"contact":"nope"},${JSON.stringify(okId)}:{"status":"offer","notes":"ok","drafts":{"evil":{"email_body":"x"},"0":{"email_subject":"kept"}}}}}`) });
await waitAccount(okId, 'offer');
const okDoc = await accountDoc(okId);
const okLocal = await vpage.evaluate((id) => localStorage.getItem(`oh:u:viewer1:t:${id}`) || '', okId);
check((await vpage.locator('.card').count()) === total && (await statusOf(vfirstId)) === 'new' && (await vpage.locator(`.card[data-id="${vfirstId}"] .notes`).inputValue()) === ''
  && (await accountDoc(vfirstId)) === null && okDoc?.notes === 'ok' && okDoc?.drafts?.['0']?.email_subject === 'kept' && !('evil' in (okDoc?.drafts || {})) && !/evil/.test(okLocal)
  && (await vpage.locator('#profile-form input[name="name"]').inputValue()) === 'Distinct Name' && (await accountProfile())?.name === 'Distinct Name', 'viewer: a crafted backup is cleaned before use and keeps the saved details');

// Restoring the backup brings the progress back, here and in the account (after a wrong file
// first, whose message gives way to the result).
await vpage.locator('#file-restore').setInputFiles({ name: 'wrong.csv', mimeType: 'text/csv', buffer: Buffer.from('company,role\nAcme,FDE') });
await vpage.waitForTimeout(300);
check(/could not be read/.test(await vpage.locator('#toast').innerText()), 'viewer: a file that is not a backup says so');
await vpage.locator('#file-restore').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(backup ? backup.data : '{}') });
await waitAccount(vfirstId, 'replied');
check(/Backup restored/.test(await vpage.locator('#toast').innerText()) && (await statusOf(vfirstId)) === 'replied' && (await accountDoc(vfirstId))?.status === 'replied', 'viewer: restoring a backup brings the progress back, here and in the account');
await vpage.click('#btn-drawer-close');

await vctx.close();

await browser.close(); server.close();
check(errors.length === 0, `no page/console errors (${errors.join(' | ') || 'none'})`);
if (fails.length) { console.error('\nFAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('\nAll smoke checks passed.');
