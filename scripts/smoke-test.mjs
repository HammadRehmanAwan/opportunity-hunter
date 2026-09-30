#!/usr/bin/env node
// Headless smoke test: serves the folder, loads the page in Chromium, and exercises the one-click actions.
// Usage: node scripts/smoke-test.mjs [--fixture]   (--fixture uses scripts/fixture-data.js instead of data/opportunities.js)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const useFixture = process.argv.includes('--fixture');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  if (useFixture && p === '/data/opportunities.js') p = '/scripts/fixture-data.js';
  const file = normalize(join(root, p));
  if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404); res.end('nope'); return; }
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

await page.addInitScript(() => { window.__nav = []; window.OH_NAV = (u) => { window.__nav.push(u); }; });
await page.goto(base, { waitUntil: 'networkidle' });
const total = await page.evaluate(() => (window.OH_DATA || []).length);
console.log(`Loaded ${base} with ${total} opportunities`);
check(total > 0, 'data loaded');
check((await page.locator('.card').count()) === total, 'one card per opportunity');
check((await page.locator('#stats .stat').count()) === 5, 'five stat tiles');

// Filters
await page.fill('#f-q', 'zzzz-no-match');
check((await page.locator('.card').count()) === 0, 'search filters everything out');
await page.fill('#f-q', '');
check((await page.locator('.card').count()) === total, 'clearing search restores all');
await page.selectOption('#f-status', 'contacted');
check((await page.locator('.card').count()) === 0, 'no contacted rows at start');
await page.selectOption('#f-status', 'any');

// Outreach on the first card
const card = page.locator('.card').first();
const company = await card.locator('.company').innerText();
await card.locator('.outreach summary').click();
const subject = await card.locator('.d-subject').inputValue();
const body = await card.locator('.d-email').inputValue();
check(subject.length > 0 && body.length > 0, `drafts present for ${company}`);
check(!/\{\{\w+\}\}/.test(subject + body), 'no unfilled {{placeholders}} in email draft');
const note = await card.locator('.d-note').inputValue();
check(note.length > 0 && note.length <= 300, `LinkedIn note within 300 chars (${note.length})`);

// Send email → navigation goes through window.OH_NAV (installed above); check the URL the app builds.
await card.locator('.act-send').click();
const nav = await page.evaluate(() => window.__nav);
check(nav.length === 1 && /^mailto:/.test(nav[0]) && /subject=/.test(nav[0]) && /body=/.test(nav[0]), 'Send email builds a mailto: link with subject and body');
check((await card.locator('.status').inputValue()) === 'contacted', 'sending marks the opportunity Contacted');

// LinkedIn one-click: copies text and opens the profile
await card.locator('.tab[data-tab="note"]').click();
await card.locator('.act-linkedin[data-kind="note"]').click();
await page.waitForFunction(() => window.__nav.length >= 2, null, { timeout: 5000 }).catch(() => {});
const nav2 = await page.evaluate(() => window.__nav);
check(nav2.length === 2 && /linkedin\.com/.test(nav2[1]), 'LinkedIn button opens a linkedin.com URL');
const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
check(clip === note, 'LinkedIn button copied the note to the clipboard');

// Edited drafts persist across reload
await card.locator('.tab[data-tab="email"]').click();
await card.locator('.d-subject').fill('Edited subject');
await card.locator('.notes').fill('Spoke on Tuesday');
await page.reload({ waitUntil: 'networkidle' });
const card2 = page.locator('.card').first();
await card2.locator('.outreach summary').click();
check((await card2.locator('.d-subject').inputValue()) === 'Edited subject', 'edited subject survives reload');
check((await card2.locator('.notes').inputValue()) === 'Spoke on Tuesday', 'notes survive reload');
check((await card2.locator('.status').inputValue()) === 'contacted', 'status survives reload');
await card2.locator('.act-reset[data-field="email"]').click();
check((await card2.locator('.d-subject').inputValue()) === subject, 'reset restores the original subject');

// Profile drawer changes drafts
await page.click('#btn-profile');
await page.fill('#profile-form input[name="name"]', 'Test Person');
await page.click('#profile-form button[type="submit"]');
const card3 = page.locator('.card').first();
await card3.locator('.outreach summary').click();
const body3 = await card3.locator('.d-email').inputValue();
check(/Test Person/.test(body3), 'profile name flows into the email draft');

// Theme toggle + CSV export
await page.click('#btn-theme');
check(['dark', 'light'].includes(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))), 'theme toggle sets data-theme');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export')]);
const csv = await (await dl.createReadStream()).toArray().then((b) => Buffer.concat(b).toString());
check(csv.split('\n').length > 1 && csv.startsWith('company,role,'), 'CSV export has a header and rows');

// Mobile viewport: no horizontal scroll
await page.setViewportSize({ width: 390, height: 800 });
await page.reload({ waitUntil: 'networkidle' });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (overflow > 0) { const wide = await page.evaluate(() => Array.from(document.querySelectorAll('body *')).filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 8).map((e) => `${e.tagName.toLowerCase()}${e.className ? '.' + String(e.className).split(' ')[0] : ''}@${Math.round(e.getBoundingClientRect().right)}`)); console.log('  overflowing: ' + wide.join(', ')); }
check(overflow <= 0, `no horizontal overflow at 390px (delta ${overflow})`);
await page.locator('.card').first().locator('.outreach summary').click();
const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check(overflow2 <= 0, `no horizontal overflow at 390px with outreach open (delta ${overflow2})`);

// Every link is http(s), mailto or an anchor
const badLinks = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map((a) => a.getAttribute('href')).filter((h) => !/^(https?:|mailto:|#)/.test(h)));
check(badLinks.length === 0, `all links are http(s)/mailto/anchor (${badLinks.join(', ') || 'none bad'})`);

await browser.close(); server.close();
check(errors.length === 0, `no page/console errors (${errors.join(' | ') || 'none'})`);
if (fails.length) { console.error('\nFAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('\nAll smoke checks passed.');
