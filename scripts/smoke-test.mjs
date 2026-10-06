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

// The send and LinkedIn actions are real links: record where they point and keep the test page in place.
const recordLinks = () => {
  window.__nav = [];
  document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a.act-send, a.act-linkedin'); if (a) { e.preventDefault(); window.__nav.push(a.href); } }, true);
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
check((await card.locator('.status').inputValue()) === 'contacted', 'sending marks the opportunity Contacted');

// LinkedIn one-click: copies text and opens the profile
await card.locator('.tab[data-tab="note"]').click();
await card.locator('.act-linkedin[data-kind="note"]').click();
await page.waitForFunction(() => window.__nav.length >= 2, null, { timeout: 5000 }).catch(() => {});
const nav2 = await page.evaluate(() => window.__nav);
check(nav2.length === 2 && /linkedin\.com/.test(nav2[1]), 'LinkedIn button opens a linkedin.com URL');
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

// "Clear everything" needs a second click
await page.setViewportSize({ width: 1280, height: 900 });
await page.reload({ waitUntil: 'networkidle' });
await page.locator('.card').first().locator('.status').selectOption('shortlisted');
await page.click('#btn-profile');
await page.click('#btn-wipe');
const notContacted = async () => Number(await page.locator('#stages .stage[data-stage="new"] .n').innerText());
check((await notContacted()) < total, 'one click on Clear everything clears nothing');
await page.click('#btn-wipe');
check((await notContacted()) === total, 'a second click on Clear everything clears progress');

// Inside the claude.ai artifact viewer, with a fake window.claude: progress saved to the account,
// Gmail links by default, and files offered through the viewer's save prompt.
const seedId = await page.evaluate(() => document.querySelectorAll('.card')[1]?.dataset.id);
const vctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await vctx.grantPermissions(['clipboard-read', 'clipboard-write']);
const vpage = await vctx.newPage();
vpage.on('pageerror', (e) => errors.push(`viewer pageerror: ${e.message}`));
vpage.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`viewer console: ${m.text()}`); });
await vpage.addInitScript(recordLinks);
await vpage.addInitScript((seed) => {
  const store = new Map(); window.__store = store; window.__saves = [];
  if (seed) store.set(`data/users/viewer1/t-${seed}`, { status: 'interviewing', notes: 'seeded', drafts: {}, contact: 0 });
  const snap = (p, v) => ({ id: p.split('/').pop(), exists: v !== undefined, data: () => v, metadata: { fromCache: false, hasPendingWrites: false } });
  const ref = (p) => ({ id: p.split('/').pop(), path: p, get: async () => snap(p, store.get(p)),
    set: async (d) => { store.set(p, JSON.parse(JSON.stringify(d))); }, delete: async () => { store.delete(p); } });
  const db = { doc: ref, collection: (c) => ({ path: c, doc: (id) => ref(`${c}/${id}`), get: async () => {
    const docs = [...store.entries()].filter(([p]) => p.startsWith(`${c}/`) && !p.slice(c.length + 1).includes('/')).map(([p, v]) => snap(p, v));
    return { docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false, hasPendingWrites: false }, docChanges: () => [] };
  } }) };
  const caps = { db, user: { id: async () => 'viewer1' }, downloads: { save: async ({ filename, data }) => { window.__saves.push({ filename, data: String(data) }); return { status: 'saved' }; } } };
  window.claude = { use: async (n) => caps[n] || null };
}, seedId);
await vpage.goto(base, { waitUntil: 'networkidle' });
await vpage.waitForFunction(() => /Claude account/.test(document.querySelector('.saved-where')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
check(/Claude account/.test(await vpage.locator('.saved-where').first().textContent()), 'viewer: says progress is saved to the Claude account');
check(!seedId || (await vpage.locator('#stages .stage[data-stage="interviewing"] .n').innerText()) === '1', 'viewer: progress saved in the account shows on load');
const vcard = vpage.locator('.card').first();
await vcard.locator('.btn-write').click();
const sendHref = await vcard.locator('.act-send').getAttribute('href');
check(/^https:\/\/mail\.google\.com\//.test(sendHref) && (await vcard.locator('.act-send').getAttribute('target')) === '_blank', 'viewer: email opens Gmail in a new tab by default');
check((await vcard.locator('.act-linkedin').first().getAttribute('target')) === '_blank' && /linkedin\.com/.test(await vcard.locator('.act-linkedin').first().getAttribute('href')), 'viewer: LinkedIn button is a real link to linkedin.com');
await vcard.locator('.d-subject').fill('Changed subject line');
check(/Changed%20subject%20line/.test(await vcard.locator('.act-send').getAttribute('href')), 'viewer: editing the subject updates the email link');
const vid = await vcard.getAttribute('data-id');
await vcard.locator('.status').selectOption('replied');
await vpage.waitForFunction((id) => window.__store.get(`data/users/viewer1/t-${id}`)?.status === 'replied', vid, { timeout: 5000 }).catch(() => {});
check((await vpage.evaluate((id) => window.__store.get(`data/users/viewer1/t-${id}`)?.status, vid)) === 'replied', 'viewer: a status change is saved to the account');
await vpage.click('#btn-export');
await vpage.waitForFunction(() => window.__saves.length > 0, null, { timeout: 5000 }).catch(() => {});
const saved = await vpage.evaluate(() => window.__saves[0]);
check(saved && saved.filename === 'opportunity-hunter.csv' && saved.data.startsWith('company,role,'), 'viewer: CSV goes through the save prompt');
await vpage.click('#btn-profile');
await vpage.click('#btn-wipe'); await vpage.click('#btn-wipe');
await vpage.waitForFunction(() => window.__store.size === 0, null, { timeout: 5000 }).catch(() => {});
check((await vpage.evaluate(() => window.__store.size)) === 0, 'viewer: Clear everything also clears the account copy');
await vctx.close();

await browser.close(); server.close();
check(errors.length === 0, `no page/console errors (${errors.join(' | ') || 'none'})`);
if (fails.length) { console.error('\nFAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('\nAll smoke checks passed.');
