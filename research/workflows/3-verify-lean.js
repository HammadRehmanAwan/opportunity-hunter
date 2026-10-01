export const meta = {
  name: 'fde-verify-lean',
  description: 'Search-based verification of FDE roles, contacts and emails (and enrichment where missing), within a tool budget',
  phases: [
    { title: 'Enrich', detail: 'only companies with no enrichment yet' },
    { title: 'Verify', detail: 'per company: listing status, contacts, emails, pattern — from search snippets' },
  ],
}
const TODAY = args.today
const companies = args.companies.map((c) => ({ ...c, file: String(c.file).replace('$SP', args.base) }))

const NET = `Tools: WebSearch works. WebFetch is BLOCKED for linkedin.com, greenhouse.io, lever.co, ashbyhq.com, workable.com, smartrecruiters.com, zoominfo.com and many company sites — try a blocked host at most once, then rely on search result titles, snippets and URLs. github.com and raw.githubusercontent.com usually fetch fine. If WebSearch/WebFetch are not in your tool list, load them with ToolSearch "select:WebSearch,WebFetch". BUDGET: at most 14 WebSearch calls and 6 WebFetch calls in total. Today is ${TODAY}. Never invent a URL, name or email.`

const ENRICH_SCHEMA = {
  type: 'object',
  properties: {
    company: { type: 'string' }, website: { type: 'string' }, linkedin_company_url: { type: 'string' }, hq: { type: 'string' },
    size_text: { type: 'string' }, what_they_do: { type: 'string' }, fde_team_context: { type: 'string' }, careers_url: { type: 'string' },
    careers_email: { type: 'string', description: 'published recruiting email or ""' }, careers_email_source_url: { type: 'string' },
    email_pattern: { type: 'string', description: 'documented company email format or ""' }, email_pattern_source_url: { type: 'string' }, email_pattern_confidence: { type: 'string' },
    contacts: { type: 'array', items: { type: 'object', properties: {
      name: { type: 'string' }, title: { type: 'string' }, linkedin_url: { type: 'string', description: 'seen in a result URL, else ""' },
      role_type: { type: 'string', description: 'hiring_manager | recruiter | fde_lead | founder | team_member' }, evidence_url: { type: 'string' },
      email_public: { type: 'string', description: 'only if published by them/the company, else ""' }, email_public_source_url: { type: 'string' }, why_them: { type: 'string' },
    }, required: ['name', 'title', 'linkedin_url', 'role_type', 'evidence_url'] } },
    linkedin_people_search_url: { type: 'string' }, notes: { type: 'string' },
  },
  required: ['company', 'website', 'what_they_do', 'careers_email', 'email_pattern', 'email_pattern_confidence', 'contacts', 'linkedin_people_search_url'],
}
const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    company: { type: 'string' },
    job_status: { type: 'string', description: 'live_fetched (you fetched the posting and it is open) | listed_recently (search shows the posting or an aggregator copy dated within ~45 days, or the careers search lists it) | unconfirmed (no recent evidence either way) | closed (posting says closed/filled or 404s)' },
    job_url_live: { type: 'boolean', description: 'true only for live_fetched or listed_recently' },
    job_url_note: { type: 'string' },
    alternate_job_url: { type: 'string', description: 'a better live posting URL for the same or an equivalent FDE role, else ""' },
    role_still_fde: { type: 'boolean', description: 'genuinely a forward-deployed / customer-embedded engineering role (not pure sales / no-code support)' },
    contacts: { type: 'array', items: { type: 'object', properties: {
      name: { type: 'string' }, linkedin_url: { type: 'string' },
      verified: { type: 'boolean', description: 'true only if a search result (title/snippet/URL) shows this person, at this company, with a matching or closely related current title, AND the LinkedIn slug matches when a linkedin_url is given' },
      note: { type: 'string' },
    }, required: ['name', 'linkedin_url', 'verified', 'note'] } },
    emails: { type: 'array', items: { type: 'object', properties: {
      email: { type: 'string' }, verified_public: { type: 'boolean', description: 'you saw the exact address published on a page or in a snippet of the company/person page' }, source_url: { type: 'string' }, note: { type: 'string' },
    }, required: ['email', 'verified_public', 'note'] } },
    email_pattern_verified: { type: 'boolean' },
    overall_confidence: { type: 'string', description: 'high | medium | low' },
    issues: { type: 'string', description: 'one line' },
  },
  required: ['company', 'job_status', 'job_url_live', 'role_still_fde', 'contacts', 'emails', 'email_pattern_verified', 'overall_confidence', 'issues'],
}

const enrichPrompt = (c) => `${NET}

Enrich ONE company for a London-based AI engineer's outreach list (target: Forward Deployed AI Engineer). Company: ${c.company}. Read ${c.file} (JSON; open_roles lists what we found). Find via search: company basics (website, LinkedIn company URL, HQ, size/stage, one-line description), what their forward-deployed / applied team does, a recruiting email the company publishes (or ""), their documented email format with a source (or ""), and 2-5 real people to approach (hiring manager / head of FDE or solutions engineering / technical recruiter / founder at small companies) with LinkedIn profile URLs you saw in result URLs and an evidence URL each. Also a LinkedIn people-search URL: https://www.linkedin.com/search/results/people/?keywords=<URL-encoded company + " forward deployed engineer OR recruiter OR head of engineering">. Be honest about gaps.`

const verifyPrompt = (c, e) => `${NET}

You are a SKEPTICAL fact-checker for a job-outreach list. Default to false when uncertain. Company: ${c.company}. Read ${c.file} (JSON with open_roles and the enrichment from an earlier pass${e ? '; that enrichment was missing, so use this fresh one instead' : ''}).
${e ? `Fresh enrichment: ${JSON.stringify(e)}` : ''}
1. Primary role = open_roles[0]. Search for it (title + company + location) and decide job_status. If it looks closed but an equivalent FDE role at this company is open, give alternate_job_url.
2. Is it genuinely a forward-deployed / customer-embedded engineering role? (role_still_fde)
3. For EACH contact in the enrichment: search "<name>" "<company>" (and "<name>" linkedin). Mark verified only per the schema rule; keep notes short.
4. For each email (careers_email and any email_public): was the exact address published? 
5. Is email_pattern supported by its cited source or by other published staff addresses?
Return the verdicts with a one-line issues summary.`

phase('Verify')
log(`${companies.length} companies (${companies.filter((c) => !c.enriched).length} need enrichment)`)
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
log(`Done: ${out.filter((r) => r.verification).length}/${companies.length} verified`)
return { results: out }
