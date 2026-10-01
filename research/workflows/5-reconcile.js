export const meta = {
  name: 'fde-reconcile-with-verification',
  description: 'Reconcile each opportunity\'s score, region and drafts with the verification findings; change only what verification contradicts',
  phases: [{ title: 'Reconcile', detail: 'per batch of five companies' }],
}
const fix = (p) => String(p).replace('$SP', args.base)
const CANDIDATE_FILE = fix(args.candidate_file)
const batches = args.batches.map((b) => b.map((c) => ({ company: c.company, file: fix(c.file) })))
const DRAFTS = { type: 'object', properties: { email_subject: { type: 'string' }, email_body: { type: 'string' }, linkedin_note: { type: 'string' }, linkedin_inmail: { type: 'string' } }, required: ['email_subject', 'email_body', 'linkedin_note', 'linkedin_inmail'] }
const ITEM = {
  type: 'object',
  properties: {
    company: { type: 'string', description: 'exactly as given' },
    changed: { type: 'boolean', description: 'true if anything below differs from "current"' },
    score: { type: 'integer' }, region: { type: 'string', description: 'UK | Europe | Remote | US | Other' }, remote_policy: { type: 'string', description: 'remote | hybrid | onsite | unknown' },
    rationale: { type: 'string' }, fit_notes: { type: 'string' },
    drafts_changed: { type: 'boolean' }, drafts: DRAFTS,
    reason: { type: 'string', description: 'one line: what the verification contradicted, or "consistent"' },
  },
  required: ['company', 'changed', 'score', 'region', 'remote_policy', 'rationale', 'fit_notes', 'drafts_changed', 'drafts', 'reason'],
}
const SCHEMA = { type: 'object', properties: { results: { type: 'array', items: ITEM } }, required: ['results'] }
const prompt = (b) => `You are the final reconciliation reviewer for a job-outreach list for one candidate (Read ${CANDIDATE_FILE}). Today is ${args.today}.
For each company below, Read its file. It holds the primary role, the enrichment summary, the latest VERIFICATION findings and the CURRENT score, region, remote_policy, rationale, fit_notes and drafts (written before verification finished).
${b.map((c) => `- ${c.company}: ${c.file}`).join('\n')}

For EACH company return one item. Change ONLY what the verification contradicts or makes clearly misleading, and otherwise return the current values unchanged:
- Region/remote_policy must describe the primary role as verified (e.g. if the verifier says the req is now US-only, region becomes US; if it says London hybrid, UK/hybrid).
- Score (1-10, same rubric: genuine FDE role; London/UK-eligible best, Europe medium, US-only low because of visa; early/mid-level friendly beats Staff/Principal; established FDE motion; contactability) drops when verification finds the role moved to the US, looks stale (unconfirmed with an expired close date), or is more senior than assumed; rises at most +1 when verification confirms a live London role and a verified hiring contact.
- rationale (<= 200 chars) and fit_notes (one line) must reflect the verification (mention "listing unconfirmed" or "US-only now" where relevant).
- Drafts: keep them unless they state something the verification contradicts (wrong location, wrong role title, a team or product claim the verifier refuted). If you edit, keep the same placeholders ({{first_name}}, {{company}}, {{role}}, {{my_name}}, {{my_first_name}}, {{my_linkedin}}, {{my_cv}}, {{signature}}), the same lengths (email 120-170 words ending with {{signature}}; note <= 280 chars filled; inmail 70-110 words ending with {{my_name}}), British spelling, no em-dashes, no exclamation marks, and no new claims about the candidate beyond the candidate file.
- reason: one line.`
phase('Reconcile')
const out = await parallel(batches.map((b) => () => agent(prompt(b), { label: `reconcile:${b.map((c) => c.company).join('+').slice(0, 60)}`, phase: 'Reconcile', schema: SCHEMA })))
const results = out.filter(Boolean).flatMap((r) => r.results || [])
log(`${results.length} reconciled; ${results.filter((r) => r.changed).length} changed; ${results.filter((r) => r.drafts_changed).length} drafts edited`)
return { results }
