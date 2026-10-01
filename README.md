# Opportunity Hunter — Forward Deployed AI Engineer

A single-page site that lists **open Forward Deployed AI Engineer roles**, the **people to approach at each company** (with LinkedIn profiles and verified or best-guess email addresses), and a **drafted email plus LinkedIn message you can send with one click**. It follows the same shape as the WYA client-hunting pipeline: *scan → filter → enrich → score → gate → outreach*.

No build step, no server, no accounts. Your approvals, notes and edited drafts are stored in your browser only.

## Run it

Open `index.html` in a browser, or serve the folder:

```bash
npx serve .          # or: python3 -m http.server 8080
```

## Privacy first

`data/opportunities.json` names real people (recruiters, hiring managers, engineers) with their LinkedIn profiles and work email addresses, some of them guessed. Treat it as a private contact list:

- Keep the repository **private**. A public repo, or a public branch of one, exposes the list to anyone.
- **GitHub Pages and Netlify sites are public by default**, even from a private repo on most plans. To keep the list private, open `index.html` locally, or deploy behind access control (Netlify password protection, Cloudflare Access, Vercel deployment protection).
- Use the list for individual, relevant outreach only. Remove anyone who asks, and don't share the file.

## Deploy

Pushing to this repo only runs **Validate data** (`.github/workflows/ci.yml`), which checks the data and that `data/opportunities.js` is up to date. Nothing is published automatically.

- **Use it privately (recommended)**: clone the repo and open `index.html` in a browser.
- **GitHub Pages**: run **Deploy to GitHub Pages** by hand from the Actions tab. Pages needs a public repo or a paid plan, and the site it creates is public.
- **Netlify**: `netlify.toml` is included. Connect the repo and turn on password protection before sharing the link.

## How the one-click actions work

| Button | What happens |
|---|---|
| **Send email ↗** | Opens your mail client (or Gmail / Outlook web, per your profile) with the recipient, subject and body pre-filled. Marks the opportunity *Contacted*. |
| **Copy note & open LinkedIn ↗** | Copies the connection note (≤ 300 chars) to the clipboard and opens the person's LinkedIn profile so you can paste it under *Connect → Add a note*. |
| **Copy message & open LinkedIn ↗** | Same, for a longer message / InMail. |
| **Draft to &lt;name&gt;** | Switches the outreach drafts to that contact and fills `{{first_name}}`, `{{contact_title}}` etc. |
| **Your profile** | Your name, email, LinkedIn, CV link and signature, used in every draft. Defaults come from `data/profile.json` (which is published with the site); edits are saved in this browser only. |
| **Export CSV** | One row per contact for the currently filtered list, including status and notes. |

Nothing is sent automatically.

## Email addresses — how to read the labels

- **published** (`email_status: "verified_public"`) — the address was found on a page the company or the person published (careers page, job post, personal site, GitHub, conference bio). Source link shown.
- **guess** (`email_status: "pattern_guess"`) — built from a documented company email pattern (for example `first.last@company.com`). It was **not** seen anywhere; verify before relying on it.
- **careers inbox** — a general recruiting address the company publishes. Used as the fallback recipient when a person has no address.

## Data

`data/opportunities.json` is the source of truth; `scripts/build-data.mjs` validates it and generates `data/opportunities.js` (committed, so the page also works from `file://`). Each opportunity has:

```
id (stable slug, required — tracker state is keyed by it),
company, company_url, linkedin_company_url, hq, size_text, what_they_do, fde_team_context,
role_title, location, region (UK|Europe|Remote|US|Other), remote_policy (remote|hybrid|onsite|unknown), job_url, posted_or_seen,
employment_type, salary_text, summary, why_fde,
score (1-10), rationale, suggested_contact, outreach_angle, fit_summary, watch_outs[] (plain-language versions shown on the cards),
careers_email, careers_email_source_url, email_pattern, email_pattern_confidence, email_pattern_source_url,
contacts[]: { name, title, role_type, linkedin_url, email, email_status (verified_public|pattern_guess), email_source_url, evidence_url, verified (true|false), why_them },
linkedin_people_search_url,
drafts: { email_subject, email_body, linkedin_note, linkedin_inmail },   // support {{placeholders}}
verification: { job_status (live_fetched|listed_recently|unconfirmed|closed), job_url_live, role_still_fde, overall_confidence, issues, checked }, sources[], last_verified
```

Placeholders available in drafts: `{{first_name}}`, `{{contact_name}}`, `{{contact_title}}`, `{{company}}`, `{{role}}`, `{{my_name}}`, `{{my_first_name}}`, `{{my_email}}`, `{{my_linkedin}}`, `{{my_phone}}`, `{{my_cv}}`, `{{my_headline}}`, `{{signature}}`.

To refresh the list, re-run the research (the discovery / enrichment / verification prompts are described on the page), update the JSON and run:

```bash
node scripts/build-data.mjs
```

## Tests

```bash
node scripts/build-data.mjs                  # validates the data and regenerates data/opportunities.js (commit the result)
npm i -D playwright-core                     # once; then either `npx playwright install chromium`
CHROMIUM_PATH=/path/to/chrome node scripts/smoke-test.mjs             # ...or point at an existing Chromium
node scripts/smoke-test.mjs --fixture        # same checks against the fictional fixture in scripts/fixture-data.js
```

The smoke test serves the folder locally, renders it in headless Chromium and exercises the one-click actions, per-recipient draft editing, persistence, the profile drawer, CSV export, a stored-XSS canary and phone-width layout.
