#!/usr/bin/env node
// Bundles the site into one HTML file for publishing as a private claude.ai artifact.
// The artifact viewer wraps the file in its own <html>/<head>/<body>, so the output starts with
// the <title>, the font link and the <style>, then the page body with the data and app inlined.
// Usage: node scripts/build-artifact.mjs [out]   (default: dist/opportunity-hunter.html)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const out = process.argv[2] || join(root, 'dist', 'opportunity-hunter.html');
const read = (p) => readFile(join(root, p), 'utf8');

const html = await read('index.html');
const pick = (re, what) => { const m = html.match(re); if (!m) throw new Error(`index.html: no ${what}`); return m; };
const title = pick(/<title>[\s\S]*?<\/title>/i, '<title>')[0];
const fonts = pick(/<link href="https:\/\/fonts\.googleapis\.com\/[^"]+" rel="stylesheet">/i, 'Google Fonts link')[0];
let body = pick(/<body[^>]*>([\s\S]*)<\/body>/i, '<body>')[1];

// Inlined script text must not end the <script> element early.
const inlineJs = (js) => js.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
for (const src of ['data/opportunities.js', 'assets/app.js']) {
  const tag = `<script src="${src}"></script>`;
  if (!body.includes(tag)) throw new Error(`index.html: no ${tag}`);
  const js = inlineJs(await read(src));
  body = body.replace(tag, () => `<script>\n${js}\n</script>`);
}
const css = (await read('assets/styles.css')).replace(/<\/(style)/gi, '<\\/$1');

const page = `${title}\n${fonts}\n<style>\n${css}\n</style>\n${body.trim()}\n`;
await mkdir(dirname(out), { recursive: true });
await writeFile(out, page);
console.log(`Wrote ${out} (${Math.round(page.length / 1024)} KB)`);
