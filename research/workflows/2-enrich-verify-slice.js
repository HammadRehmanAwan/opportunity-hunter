export const meta = {
  name: 'fde-enrich-verify-slice',
  description: 'Enrich (if needed) and verify a slice of FDE-hiring companies: contacts, LinkedIn URLs, public emails, live job links',
  phases: [
    { title: 'Enrich', detail: 'per company without prior enrichment: contacts, emails, context' },
    { title: 'Verify', detail: 'per company: sceptic re-checks URLs, people, emails' },
  ],
}
const TODAY = args.today
const SLICE = args.slice
const companies = args.companies

const TOOLING = `Tools: you have Read (for the local JSON file named below), WebSearch and WebFetch (if WebSearch/WebFetch are not in your tool list, load them with ToolSearch "select:WebSearch,WebFetch" first). Use the web heavily — do NOT answer from memory. Today is ${TODAY}. Never invent a URL or an email address: every URL must be one you actually saw in a search result or fetched page. Return concise text fields (<= 240 chars each).
The file ${SLICE} holds a JSON object {companies:[...]} — find the entry whose "company" matches yours; it lists the open roles we found (title, location, job_url, source_url, summary) and, when present, an "enrichment" object from an earlier pass.`

const ENRICH_SCHEMA = {
  type: 'object',
  properties: {
    company: { type: 'string' }, website: { type: 'string' }, linkedin_company_url: { type: 'string' }, hq: { type: 'string' },
    size_text: { type: 'string', description: 'headcount / stage / funding, one line' },
    what_they_do: { type: 'string' },
    fde_team_context: { type: 'string', description: 'what their forward-deployed / applied team does, from their own pages or posts' },
    careers_url: { type: 'string' },
    careers_email: { type: 'string', description: 'a recruiting/careers/jobs email PUBLISHED by the company or "" if none found' },
    careers_email_source_url: { type: 'string' },
    email_pattern: { type: 'string', description: 'company email format if publicly documented, e.g. "first.last@company.com"; "" if unknown' },
    email_pattern_source_url: { type: 'string' },
    email_pattern_confidence: { type: 'string', description: 'high | medium | low' },
    contacts: {
      type: 'array',
      description: '2-5 real, currently-employed people worth approaching: hiring manager / head of forward-deployed or applied engineering, a technical recruiter, an FDE team lead, or a founder at small companies',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' }, title: { type: 'string' },
          linkedin_url: { type: 'string', description: 'public profile URL you actually saw (linkedin.com/in/...). "" if not found — never guess a slug' },
          role_type: { type: 'string', description: 'hiring_manager | recruiter | fde_lead | founder | team_member' },
          evidence_url: { type: 'string', description: 'page proving they hold this title now' },
          email_public: { type: 'string', description: 'ONLY an address this person or company has published publicly. "" otherwise. Never construct one.' },
          email_public_source_url: { type: 'string' },
          why_them: { type: 'string' },
        },
        required: ['name', 'title', 'linkedin_url', 'role_type', 'evidence_url'],
      },
    },
    linkedin_people_search_url: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['company', 'website', 'what_they_do', 'careers_email', 'email_pattern', 'email_pattern_confidence', 'contacts', 'linkedin_people_search_url'],
}
const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    company: { type: 'string' },
    job_url_live: { type: 'boolean' }, job_url_note: { type: 'string' },
    alternate_job_url: { type: 'string', description: 'live posting URL if the original is dead; else ""' },
    role_still_fde: { type: 'boolean', description: 'is this genuinely a forward-deployed / customer-embedded AI engineering role' },
    contacts: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, linkedin_url: { type: 'string' }, verified: { type: 'boolean' }, note: { type: 'string' } }, required: ['name', 'linkedin_url', 'verified', 'note'] } },
    emails: { type: 'array', items: { type: 'object', properties: { email: { type: 'string' }, verified_public: { type: 'boolean' }, source_url: { type: 'string' }, note: { type: 'string' } }, required: ['email', 'verified_public', 'note'] } },
    email_pattern_verified: { type: 'boolean' },
    overall_confidence: { type: 'string', description: 'high | medium | low' },
    issues: { type: 'string' },
  },
  required: ['company', 'job_url_live', 'role_still_fde', 'contacts', 'emails', 'email_pattern_verified', 'overall_confidence'],
}

const enrichPrompt = (c) => `${TOOLING}

You are enriching ONE company for a job-seeker's outreach list (target role: Forward Deployed AI Engineer; the job-seeker is a London-based AI engineer). Company: ${c.company}. First Read ${SLICE} and locate this company's roles.

Find, using web search and fetching real pages:
1. Company basics: website, LinkedIn company page URL, HQ, size/stage/funding, one-line description, and what their forward-deployed / applied-AI team actually does (from their blog, job post, or engineering posts).
2. A recruiting/careers email the company itself publishes (careers@, jobs@, recruiting@, talent@) — search "site:<domain> careers@" / "jobs@" and fetch the careers/contact page. Leave "" if none is published; NEVER invent one.
3. The company's email address format if it is publicly documented (search "<company> email format", published staff emails on their site, press contacts, GitHub commits, papers). Report the pattern with the source URL and your confidence. Do not build individual addresses from it.
4. 2-5 real people to approach, with their PUBLIC LinkedIn profile URLs: the hiring manager for this role (often named in the job post or team page), the head of forward-deployed / applied / solutions engineering, a technical recruiter who posts these roles (search LinkedIn posts: "<company> forward deployed engineer hiring"), or a founder/CTO at small companies. Give an evidence URL showing they hold that title now. Only include a LinkedIn URL you actually saw; otherwise "". A person's email only if they published it themselves; otherwise "".
5. A LinkedIn people-search URL: https://www.linkedin.com/search/results/people/?keywords=<URL-encoded: company name + " forward deployed engineer OR recruiter OR head of engineering">.
Be honest about gaps. Keep fields concise.`

const verifyPrompt = (c, e) => `${TOOLING}

You are a SKEPTICAL fact-checker. Refute anything you cannot confirm by fetching pages yourself. Default to verified=false when uncertain. Company: ${c.company}. First Read ${SLICE} and locate this company's roles${e ? '' : ' and its "enrichment" object (produced by an earlier pass)'}.
${e ? `Enrichment claimed: ${JSON.stringify(e)}` : ''}

Check:
1. Fetch the primary job URL (the first role listed). Is it live and does it show an open forward-deployed / customer-embedded AI engineering role? If dead, search for the live posting and put it in alternate_job_url.
2. For each contact in the enrichment: does a person with that name hold that title at this company NOW? Does the linkedin_url belong to them (fetch it, or find it in search results showing the slug with their name and company)? verified=true only with evidence.
3. For each email (careers email and any person email): was it published on a page you can fetch? Mark verified_public with the source URL.
4. Is the email_pattern supported by the cited source?
Report issues plainly.`

phase('Enrich')
log(`Slice ${SLICE}: ${companies.length} companies, ${companies.filter((c) => !c.enriched).length} to enrich`)
// NOTE: a stage returning null drops the item, so pre-enriched companies pass a sentinel instead.
const results = await pipeline(companies,
  (c) => c.enriched ? Promise.resolve({ __pre: true }) : agent(enrichPrompt(c), { label: `enrich:${c.company}`, phase: 'Enrich', schema: ENRICH_SCHEMA }),
  (e, c) => {
    const fresh = e && !e.__pre ? e : null
    if (!c.enriched && !fresh) return null
    return agent(verifyPrompt(c, fresh), { label: `verify:${c.company}`, phase: 'Verify', schema: VERIFY_SCHEMA }).then((v) => ({ company: c.company, enrichment: fresh, verification: v }))
  },
)
const out = results.filter(Boolean)
log(`Done: ${out.length}/${companies.length}`)
return { slice: SLICE, results: out }
