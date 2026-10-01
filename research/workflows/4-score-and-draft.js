export const meta = {
  name: 'fde-score-and-draft-batched',
  description: 'Score FDE opportunities 1-10 and write personalised email + LinkedIn drafts in batches of three companies, each batch reviewed by a sceptical editor',
  phases: [
    { title: 'Draft', detail: 'per batch: score, rationale, angle, email + LinkedIn drafts' },
    { title: 'Critique', detail: 'per batch: editor checks accuracy, placeholders, lengths, tone; returns revised drafts' },
  ],
}
const TODAY = args.today
const fix = (p) => String(p).replace('$SP', args.base)
const CANDIDATE_FILE = fix(args.candidate_file)
const batches = args.batches.map((b) => b.map((c) => ({ company: c.company, file: fix(c.file) })))

const DRAFT_ITEM = {
  type: 'object',
  properties: {
    company: { type: 'string', description: 'exactly as given' },
    score: { type: 'integer', description: '1-10 fit score for THIS candidate' },
    rationale: { type: 'string', description: 'one line, <= 200 chars, why this score' },
    suggested_contact: { type: 'string', description: 'role/title to target first' },
    outreach_angle: { type: 'string', description: 'one line: the hook that connects the candidate to this company' },
    fit_notes: { type: 'string', description: 'one line: caveats (seniority, location, visa, travel)' },
    tags: { type: 'array', items: { type: 'string' }, description: '3-5 short tags' },
    region: { type: 'string', description: 'UK | Europe | Remote | US | Other — UK if the primary role (first open role) is in the UK; Remote if remote-anywhere/EMEA/UK-eligible remote; Europe for continental EU; US for US-only' },
    remote_policy: { type: 'string', description: 'remote | hybrid | onsite | unknown' },
    company_type: { type: 'string', description: 'e.g. "frontier lab", "applied-AI startup", "enterprise software", "consultancy"' },
    drafts: {
      type: 'object',
      properties: { email_subject: { type: 'string' }, email_body: { type: 'string' }, linkedin_note: { type: 'string' }, linkedin_inmail: { type: 'string' } },
      required: ['email_subject', 'email_body', 'linkedin_note', 'linkedin_inmail'],
    },
  },
  required: ['company', 'score', 'rationale', 'suggested_contact', 'outreach_angle', 'fit_notes', 'tags', 'region', 'remote_policy', 'company_type', 'drafts'],
}
const DRAFT_SCHEMA = { type: 'object', properties: { results: { type: 'array', items: DRAFT_ITEM } }, required: ['results'] }
const CRITIC_ITEM = {
  type: 'object',
  properties: {
    company: { type: 'string' },
    ok_as_is: { type: 'boolean' },
    problems: { type: 'string', description: 'what was wrong, or "none"' },
    drafts: {
      type: 'object',
      properties: { email_subject: { type: 'string' }, email_body: { type: 'string' }, linkedin_note: { type: 'string' }, linkedin_inmail: { type: 'string' } },
      required: ['email_subject', 'email_body', 'linkedin_note', 'linkedin_inmail'],
    },
    score_adjustment: { type: 'integer', description: '-2..+2 if the score was clearly off, else 0' },
    score_note: { type: 'string' },
  },
  required: ['company', 'ok_as_is', 'problems', 'drafts', 'score_adjustment', 'score_note'],
}
const CRITIC_SCHEMA = { type: 'object', properties: { results: { type: 'array', items: CRITIC_ITEM } }, required: ['results'] }

const STYLE = `plain, specific, confident, no flattery, no buzzwords ("passionate", "leverage", "synergy", "excited"), no em-dashes, no exclamation marks, British spelling. Lead with one concrete thing about THEIR forward-deployed work (from the dossier; never invent facts about the company or person), then the two or three candidate proof points that map most directly onto it, then ONE ask (a 15-minute call, to be considered for the role, or who the right person is). Never claim experience the candidate does not have. Never mention this list, tooling, or that the message was drafted. Do not mention salary.`
const RULES = `PLACEHOLDERS (the site fills them at send time; use exactly these and no others): {{first_name}} (the recipient's first name — ALWAYS the greeting, so one draft works for any contact at the company), {{company}}, {{role}}, {{my_name}}, {{my_first_name}}, {{my_linkedin}}, {{my_cv}}, {{signature}}. Never hard-code a contact's name or title in the drafts.
STYLE: ${STYLE}
LENGTHS: email_subject <= 70 chars and specific (role or their work, not "Opportunity"). email_body 120-170 words in 3-4 short paragraphs, ending with "{{signature}}" alone on the last line. linkedin_note HARD LIMIT 280 characters once filled (assume {{first_name}} is 8 chars, {{company}} is the real name, {{my_first_name}} is "Hammad"); one or two sentences, one hook, asks to connect. linkedin_inmail 70-110 words, greeting with {{first_name}}, ending with "{{my_name}}".`
const RUBRIC = `SCORE 1-10 for this candidate: (a) must be a genuine forward-deployed / customer-embedded AI engineering role, else <= 4; (b) location: London or UK-eligible remote highest, continental Europe medium, US-only low (visa) unless remote-worldwide; (c) stack: LLM apps/agents, Python/TypeScript, CRM/Slack/automation integrations score higher; (d) seniority: early-career/mid-level friendly beats Staff/Principal/Director/8+ years (penalise clearly senior reqs by 2-3 points); (e) company signal: funded/growing with an established FDE motion; (f) contactability: named hiring manager or recruiter with a LinkedIn URL. If the dossier's verification says the role is closed or not FDE, score <= 3.`

const fileList = (b) => b.map((c) => `- ${c.company}: ${c.file}`).join('\n')
const draftPrompt = (b) => `You are writing job-outreach for one candidate to ${b.length} companies. Today is ${TODAY}.
Read these local files first (use the Read tool):
- Candidate profile: ${CANDIDATE_FILE}
- Company dossiers (JSON: open_roles[0] is the primary role; enrichment has what_they_do, fde_team_context, contacts, emails; verification may be null):
${fileList(b)}

For EACH company return one item in "results" with the company name exactly as given above.
TASK 1 — ${RUBRIC} Give rationale, suggested_contact, outreach_angle, fit_notes, 3-5 tags, region, remote_policy and company_type. Region and remote_policy describe the PRIMARY role (open_roles[0]).
TASK 2 — write the drafts.
${RULES}
Make each company's drafts genuinely specific to that company's FDE work; do not reuse the same paragraph across companies.`

const criticPrompt = (b, d) => `You are a sceptical editor reviewing job-outreach drafts before they are sent. Today is ${TODAY}.
Read these local files first (use the Read tool):
- Candidate profile: ${CANDIDATE_FILE}
- Company dossiers:
${fileList(b)}

DRAFTS + SCORES TO REVIEW:
${JSON.stringify(d.results || [], null, 0)}

For EACH company return one item (company name exactly as given) and FIX by returning revised drafts (return them unchanged only if they truly pass):
1. Accuracy: every claim about the company/team must be supported by its dossier; every claim about the candidate must appear in the candidate profile. Remove or soften anything else (watch for invented metrics, customers, products or titles).
2. Placeholders: only {{first_name}}, {{company}}, {{role}}, {{my_name}}, {{my_first_name}}, {{my_linkedin}}, {{my_cv}}, {{signature}}; greeting uses {{first_name}}; no hard-coded contact names/titles.
3. Lengths: subject <= 70 chars; email 120-170 words ending with {{signature}} alone on the last line; linkedin_note <= 280 chars once filled (count it: {{first_name}} = 8 chars, {{company}} = the real name, {{my_first_name}} = "Hammad"); inmail 70-110 words.
4. Style: ${STYLE}
5. Score sanity against this rubric: ${RUBRIC} If the score is clearly off, set score_adjustment (-2..+2) and explain in score_note; else 0 and "".`

phase('Draft')
log(`${batches.length} batches, ${batches.reduce((n, b) => n + b.length, 0)} companies`)
const out = await pipeline(batches,
  (b, _, i) => agent(draftPrompt(b), { label: `draft:${b.map((c) => c.company).join('+').slice(0, 60)}`, phase: 'Draft', schema: DRAFT_SCHEMA }),
  (d, b) => d
    ? agent(criticPrompt(b, d), { label: `critique:${b.map((c) => c.company).join('+').slice(0, 60)}`, phase: 'Critique', schema: CRITIC_SCHEMA })
        .then((r) => b.map((c) => ({ company: c.company, draft: (d.results || []).find((x) => x.company === c.company) || null, critique: r ? (r.results || []).find((x) => x.company === c.company) || null : null })))
    : null,
)
const results = out.filter(Boolean).flat()
log(`Drafted ${results.filter((r) => r.draft).length} companies; critic revised ${results.filter((r) => r.critique && !r.critique.ok_as_is).length}`)
return { today: TODAY, results }
