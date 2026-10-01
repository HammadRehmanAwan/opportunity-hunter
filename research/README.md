# Research pipeline

How `data/opportunities.json` was produced, so the list can be refreshed. It mirrors the WYA client-hunting flow: **scan → filter → enrich → score → gate**.

| Step | File | What it does |
|---|---|---|
| 1. Discover | `workflows/1-discover-enrich-verify.js` | Eight parallel finders search careers pages, ATS boards and job aggregators for forward-deployed AI roles from different angles (frontier labs, applied-AI startups, London/UK, remote/EU, job boards, enterprise/cloud, YC/VC portfolios, adjacent titles). Results are de-duplicated by company and ranked by London / EMEA fit. |
| 2. Enrich | `workflows/2-enrich-verify-slice.js` | Per company: what the forward-deployed team does, 2–5 people to approach with public LinkedIn URLs and evidence links, any email the company or person has published, and the documented company email format. |
| 3. Verify | `workflows/3-verify-lean.js` | A sceptical, search-only pass (LinkedIn and most ATS hosts block automated fetches) that labels each listing `live_fetched`, `listed_recently`, `unconfirmed` or `closed`, confirms or rejects each contact, and checks each email was actually published. |
| 4. Score + draft | `workflows/4-score-and-draft.js` | Scores each company 1–10 for the candidate in `candidate.txt`, writes the email, LinkedIn note and LinkedIn message, then a second editor agent fact-checks each batch against the dossier and the candidate profile and rewrites anything unsupported. |
| 5. Reconcile | `workflows/5-reconcile.js` | Drafting ran before verification finished, so a final reviewer re-reads each record against its verification and changes only what it contradicts (region now US-only, stale listing, more senior than assumed), including the drafts where a claim no longer holds. |
| 6. Assemble | `assemble.mjs` | Merges everything into `data/opportunities.json`, applies `overrides.json`, builds pattern-based email guesses, and writes a QA report. |

The workflow scripts run with Claude Code's Workflow tool; their `args` point at a scratch directory holding the intermediate JSON files.

## Rules the assembler enforces

- **Published emails** are kept only on a company domain (website, documented pattern or careers inbox). Personal inboxes found in commits or CVs are not used for cold outreach.
- **Guessed emails** are generated only from a documented pattern with high confidence, or with medium confidence that the verifier did not refute. Names with particles (van, de…), brackets, abbreviated surnames or more than two parts get no guess.
- **Dropped**: roles the verifier judged not to be forward-deployed engineering, and postings it found closed with no live alternative.
- **Draft QA**: unknown placeholders, em-dashes, exclamation marks, buzzwords, hard-coded contact names, email length, missing `{{signature}}` / `{{first_name}}`, and LinkedIn notes over 300 characters once filled.
