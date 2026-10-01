export const meta = {
  name: 'fde-opportunity-discovery',
  description: 'Discover open Forward Deployed AI Engineer roles, enrich each company with hiring contacts and public emails, verify every claim',
  phases: [
    { title: 'Discover', detail: '8 finders, each searching a different angle' },
    { title: 'Enrich', detail: 'per company: contacts, LinkedIn, public emails, context' },
    { title: 'Verify', detail: 'per company: skeptic re-checks URLs, people, emails' },
  ],
}

const TODAY = args.today
const TOOLING = `Tools: you have WebSearch and WebFetch (if they are not in your tool list, load them with ToolSearch "select:WebSearch,WebFetch" first). Use them heavily — do NOT answer from memory. Today is ${TODAY}. Only report roles that are OPEN NOW (visible on a live careers page / job board page you fetched, or posted within the last ~60 days). Never invent a URL: every job_url must be a URL you actually saw in a search result or fetched page. Return concise text fields (<= 240 chars each).`

const JOBS_SCHEMA = {
  type: 'object',
  properties: {
    jobs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          company: { type: 'string' },
          role_title: { type: 'string' },
          location: { type: 'string', description: 'city/country as listed; "Remote" if remote' },
          remote_policy: { type: 'string', description: 'onsite | hybrid | remote | unknown' },
          job_url: { type: 'string', description: 'direct posting URL you actually saw' },
          source_url: { type: 'string', description: 'search result or page where you found it' },
          posted_or_seen: { type: 'string', description: 'posting date if shown, else "seen live <date>"' },
          employment_type: { type: 'string' },
          salary_text: { type: 'string', description: 'as listed, or ""' },
          summary: { type: 'string', description: 'one line: what the role does' },
          why_fde: { type: 'string', description: 'one line: why this counts as a forward-deployed / customer-embedded AI engineering role' },
          confidence: { type: 'string', description: 'high | medium | low that the role is open right now' },
        },
        required: ['company', 'role_title', 'location', 'job_url', 'source_url', 'summary', 'confidence'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['jobs'],
}

const ENRICH_SCHEMA = {
  type: 'object',
  properties: {
    company: { type: 'string' },
    website: { type: 'string' },
    linkedin_company_url: { type: 'string' },
    hq: { type: 'string' },
    size_text: { type: 'string', description: 'headcount / stage / funding, one line' },
    what_they_do: { type: 'string' },
    fde_team_context: { type: 'string', description: 'what their forward-deployed / applied team does, from their own pages or posts' },
    careers_url: { type: 'string' },
    careers_email: { type: 'string', description: 'a recruiting/careers/jobs email PUBLISHED by the company (careers@, jobs@, recruiting@, hiring@) or "" if none found' },
    careers_email_source_url: { type: 'string' },
    email_pattern: { type: 'string', description: 'company email format if publicly documented, e.g. "first.last@company.com" or "first@company.com"; "" if unknown' },
    email_pattern_source_url: { type: 'string' },
    email_pattern_confidence: { type: 'string', description: 'high | medium | low' },
    contacts: {
      type: 'array',
      description: '2-5 real, currently-employed people worth approaching: the hiring manager / head of forward-deployed or applied engineering, a technical recruiter, an FDE team lead, or a founder at small companies',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          title: { type: 'string' },
          linkedin_url: { type: 'string', description: 'public profile URL you actually saw (linkedin.com/in/...). "" if not found — never guess a slug' },
          role_type: { type: 'string', description: 'hiring_manager | recruiter | fde_lead | founder | team_member' },
          evidence_url: { type: 'string', description: 'page proving they hold this title now' },
          email_public: { type: 'string', description: 'ONLY an address this person or company has published publicly (personal site, GitHub, conference bio, job post). "" otherwise. Never construct one.' },
          email_public_source_url: { type: 'string' },
          why_them: { type: 'string' },
        },
        required: ['name', 'title', 'linkedin_url', 'role_type', 'evidence_url'],
      },
    },
    linkedin_people_search_url: { type: 'string', description: 'https://www.linkedin.com/search/results/people/?keywords=<company> forward deployed engineer OR recruiter ... URL-encoded' },
    notes: { type: 'string' },
  },
  required: ['company', 'website', 'what_they_do', 'careers_email', 'email_pattern', 'email_pattern_confidence', 'contacts', 'linkedin_people_search_url'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    company: { type: 'string' },
    job_url_live: { type: 'boolean' },
    job_url_note: { type: 'string' },
    alternate_job_url: { type: 'string', description: 'if the original is dead but you found the live posting, put it here; else ""' },
    role_still_fde: { type: 'boolean', description: 'is this genuinely a forward-deployed / customer-embedded AI engineering role' },
    contacts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          linkedin_url: { type: 'string' },
          verified: { type: 'boolean', description: 'the person exists, the LinkedIn URL is theirs, and they currently hold a relevant title at this company' },
          note: { type: 'string' },
        },
        required: ['name', 'linkedin_url', 'verified', 'note'],
      },
    },
    emails: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          verified_public: { type: 'boolean', description: 'you saw it published on a page you fetched' },
          source_url: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['email', 'verified_public', 'note'],
      },
    },
    email_pattern_verified: { type: 'boolean' },
    overall_confidence: { type: 'string', description: 'high | medium | low' },
    issues: { type: 'string' },
  },
  required: ['company', 'job_url_live', 'role_still_fde', 'contacts', 'emails', 'email_pattern_verified', 'overall_confidence'],
}

const FINDERS = [
  { key: 'frontier-labs', prompt: `Find OPEN "Forward Deployed Engineer" (and "Forward Deployed AI Engineer", "Forward Deployed Software Engineer", "Deployed Engineer") roles at frontier AI labs and model providers: OpenAI, Anthropic, Google DeepMind, Cohere, Mistral, xAI, Meta, Microsoft AI, Amazon/AWS (Bedrock, Generative AI Innovation Center), Perplexity, ElevenLabs, Runway, Stability, AI21, Writer. Fetch their careers pages (e.g. openai.com/careers, anthropic.com/jobs, jobs.ashbyhq.com, boards.greenhouse.io, jobs.lever.co) and list every matching open role with location. Aim for 10-20 roles.` },
  { key: 'applied-ai-startups', prompt: `Find OPEN Forward Deployed Engineer / Forward Deployed AI Engineer roles at applied-AI startups that sell into enterprises and embed engineers with customers: Palantir, Scale AI, Sierra, Decagon, Harvey, Glean, Cognition, Cresta, Ada, Observe.AI, Hebbia, Rogo, Norm AI, Abridge, Ambience, Hippocratic AI, Tennr, Distyl AI, Applied Intuition, Anduril, Vannevar Labs, Fireworks AI, Together AI, Baseten, Modal, Contextual AI, Unstructured, LangChain, LlamaIndex, Weights & Biases, Arize. Fetch careers pages and list every open FDE-type role with location. Aim for 15-25 roles.` },
  { key: 'london-uk', prompt: `Find OPEN Forward Deployed Engineer / Forward Deployed AI Engineer / Deployed AI Engineer roles based in LONDON or the UK (or hybrid London). Search LinkedIn Jobs, Otta/Welcome to the Jungle, Indeed UK, Glassdoor, Cord, workatastartup, jobs.ashbyhq.com, greenhouse and company sites. Include UK-based AI companies (e.g. Synthesia, ElevenLabs, PolyAI, Tessian, Humanloop, Robin AI, Luminance, Faculty, Quantexa, Builder.ai, Wayve, Speechmatics, Beamery, Cleo, Onfido, Darktrace, Peak AI, Signal AI, Eigen, V7, Tractable) and global companies hiring FDEs in London (Palantir London, OpenAI London, Anthropic London, Scale AI London, Cognition, Harvey London, Sierra London, Decagon London, Glean London, Databricks London, Snowflake London). Aim for 15-25 roles, each with the actual posting URL.` },
  { key: 'remote-eu', prompt: `Find OPEN Forward Deployed Engineer / Forward Deployed AI Engineer roles that are REMOTE (worldwide, EMEA, Europe, or UK-eligible) or based in continental Europe (Paris, Berlin, Amsterdam, Dublin, Zurich, Stockholm). Search job boards (LinkedIn Jobs, RemoteOK, Wellfound, workatastartup, Otta, jobs.ashbyhq.com, greenhouse, lever) and company careers pages (Mistral, Hugging Face, Aleph Alpha, Helsing, Poolside, H Company, Photoroom, Dust, Parloa, Cognigy, DeepL, Lovable, Sana, Legora, Leya, Lovelace). Aim for 12-20 roles with real posting URLs.` },
  { key: 'job-boards', prompt: `Search job aggregators for the exact phrase "forward deployed engineer" AND ("AI" OR "LLM" OR "machine learning"): LinkedIn Jobs (linkedin.com/jobs/search), Indeed, Glassdoor, Wellfound, Otta, Built In, RemoteOK, Himalayas, workatastartup.com, jobs.ashbyhq.com, boards.greenhouse.io, jobs.lever.co, ai-jobs.net, aijobs.ai. Collect the DISTINCT companies with currently-open FDE postings and the direct posting URL for each. Prefer companies not obviously covered by frontier labs (OpenAI/Anthropic) or Palantir. Aim for 20-30 distinct companies.` },
  { key: 'enterprise-cloud', prompt: `Find OPEN Forward Deployed Engineer / Forward Deployed AI Engineer / "AI Deployment Engineer" / "GenAI Solutions Architect (customer-embedded)" roles at large enterprise-software and cloud companies: Databricks, Snowflake, Datadog, ServiceNow, Salesforce (Agentforce FDE), Microsoft (Azure AI, Industry Solutions), AWS (Generative AI Innovation Center, ProServe), Google Cloud (AI engineers, Applied AI Engineering), IBM, Oracle, SAP, Nvidia (Solutions Architect / Forward Deployed), C3.ai, UiPath, Workday, Adobe, Twilio, Cloudflare, MongoDB, Elastic, Confluent, HashiCorp, Vercel, Retool. Fetch careers pages / job boards and list every open matching role with location. Aim for 12-20 roles.` },
  { key: 'yc-a16z', prompt: `Find OPEN Forward Deployed Engineer roles at recently funded AI startups (YC 2024-2026 batches, a16z / Sequoia / Index / Accel / General Catalyst portfolio). Search workatastartup.com for "forward deployed", Wellfound, and news of "forward deployed engineer" hiring (TechCrunch, The Information, Lenny's Newsletter, "FDE" blog posts). Examples to check: Decagon, Sierra, Clay, Mercor, Legora, Harvey, Rilla, Rogo, Reducto, Tennr, Delve, Parahelp, Camber, Freed, Numeral, Fizz, Anrok, Bland, Vapi, Retell, Cartesia, Assort Health, Distyl, OpenEvidence, Ambience, Cohere Health, Norm AI, Hebbia, EvenUp, Eve Legal, Dropzone, Zip, Ramp (Applied AI), Brex, Rippling, Deel. Aim for 15-25 roles with real posting URLs.` },
  { key: 'adjacent-titles', prompt: `Find OPEN roles that are forward-deployed AI engineering in substance but use ADJACENT titles: "Applied AI Engineer (customer-facing)", "AI Solutions Engineer", "Deployment Strategist", "Customer Engineer, AI", "AI Implementation Engineer", "Solutions Architect, LLM", "Member of Technical Staff, Deployed", "GenAI Engineer, Professional Services", "Field AI Engineer", "Technical Account Engineer (AI)". Focus on companies whose posting explicitly says the engineer embeds with customers / ships production AI with customers. Search LinkedIn Jobs, careers pages, greenhouse/ashby/lever boards. Prefer UK/Europe/remote but include US. Aim for 15-25 roles with real posting URLs.` },
]

phase('Discover')
log(`Discovering open FDE roles with ${FINDERS.length} finders`)
const found = await parallel(FINDERS.map(f => () =>
  agent(`${TOOLING}\n\nTASK (angle: ${f.key}): ${f.prompt}\n\nReturn every role you can confirm. Do not pad with roles you did not see.`,
    { label: `find:${f.key}`, phase: 'Discover', schema: JOBS_SCHEMA })))

// Barrier justified: dedupe across ALL finders before spending enrich/verify agents per company.
const allJobs = found.filter(Boolean).flatMap(r => r.jobs || [])
log(`Finders returned ${allJobs.length} raw roles`)
const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const byCompany = new Map()
for (const j of allJobs) {
  if (!j.company || !j.job_url) continue
  const k = norm(j.company).replace(/\b(inc|ltd|limited|plc|ai|labs)\b/g, '').trim() || norm(j.company)
  if (!byCompany.has(k)) byCompany.set(k, { company: j.company, roles: [], finders: new Set() })
  const c = byCompany.get(k)
  const dupRole = c.roles.find(r => r.job_url === j.job_url || (norm(r.role_title) === norm(j.role_title) && norm(r.location) === norm(j.location)))
  if (!dupRole) c.roles.push(j)
  c.finders.add(j.source_url)
}
const ukRe = /london|united kingdom|\buk\b|england|manchester|cambridge|edinburgh|remote|emea|europe|paris|berlin|amsterdam|dublin|zurich/i
const companies = Array.from(byCompany.values()).map(c => {
  const ukFit = c.roles.some(r => ukRe.test(r.location + ' ' + (r.remote_policy || '')))
  const conf = c.roles.filter(r => r.confidence === 'high').length
  return { ...c, finders: c.finders.size, ukFit, score: (ukFit ? 10 : 0) + conf * 2 + c.roles.length }
}).sort((a, b) => b.score - a.score)
const CAP = 48
const kept = companies.slice(0, CAP)
const dropped = companies.slice(CAP).map(c => c.company)
log(`${companies.length} distinct companies; enriching top ${kept.length}${dropped.length ? `, dropping ${dropped.length}: ${dropped.join(', ')}` : ''}`)

const enrichPrompt = c => `${TOOLING}

You are enriching ONE company for a job-seeker's outreach list (target role: Forward Deployed AI Engineer; the job-seeker is a London-based AI engineer).
Company: ${c.company}
Open roles we found: ${JSON.stringify(c.roles.map(r => ({ title: r.role_title, location: r.location, url: r.job_url })))}

Find, using web search and fetching real pages:
1. Company basics: website, LinkedIn company page URL, HQ, size/stage/funding, one-line description, and what their forward-deployed / applied-AI team actually does (from their blog, job post, or engineering posts).
2. A recruiting/careers email the company itself publishes (careers@, jobs@, recruiting@, talent@) — search "site:<domain> careers@" / "jobs@" / "recruiting@" and fetch the careers/contact page. Leave "" if none is published; NEVER invent one.
3. The company's email address format if it is publicly documented (search "<company> email format", look at published staff emails on their site, press contacts, GitHub commits, academic papers). Report the pattern (e.g. "first.last@domain") with the source URL and your confidence. Do not build individual addresses from it.
4. 2-5 real people to approach, with their PUBLIC LinkedIn profile URLs: the hiring manager for this role (often named in the job post or on the team page), the head of forward-deployed / applied / solutions engineering, a technical recruiter who posts these roles (search LinkedIn posts: "<company> forward deployed engineer hiring"), or a founder/CTO at small companies. For each, give an evidence URL (LinkedIn post, team page, press, podcast) showing they hold that title now. Only include a LinkedIn URL you actually saw on a page or search result; otherwise "". Any email for a person must be one they published themselves (personal site, GitHub profile, conference bio, job post "email me at") — otherwise "".
5. A LinkedIn people-search URL of the form https://www.linkedin.com/search/results/people/?keywords=<URL-encoded: company name + " forward deployed engineer OR recruiter OR head of engineering">.

Be honest about gaps. Keep fields concise.`

const verifyPrompt = (c, e) => `${TOOLING}

You are a SKEPTICAL fact-checker. Another agent produced this enrichment for a job-outreach list. Refute anything you cannot confirm by fetching pages yourself. Default to verified=false when uncertain.
Company: ${c.company}
Roles claimed: ${JSON.stringify(c.roles.map(r => ({ title: r.role_title, location: r.location, url: r.job_url })))}
Enrichment claimed: ${JSON.stringify(e)}

Check:
1. Fetch the primary job URL (the first role). Is it live and does it show an open forward-deployed / customer-embedded AI engineering role? If the URL is dead, search for the live posting and put it in alternate_job_url.
2. For each contact: does a person with that name hold that title at this company NOW? Does the linkedin_url belong to them (fetch it or find it in search results; LinkedIn may block fetches — then rely on search snippets showing the slug with their name and company)? Mark verified=true only with evidence.
3. For each email (careers email and any person email): was it actually published on a page you can fetch? Mark verified_public accordingly with the source URL.
4. Is the email_pattern supported by the cited source?
Report issues plainly.`

phase('Enrich')
const results = await pipeline(kept,
  c => agent(enrichPrompt(c), { label: `enrich:${c.company}`, phase: 'Enrich', schema: ENRICH_SCHEMA }),
  (e, c) => e
    ? agent(verifyPrompt(c, e), { label: `verify:${c.company}`, phase: 'Verify', schema: VERIFY_SCHEMA })
        .then(v => ({ company: c.company, roles: c.roles, ukFit: c.ukFit, finders: c.finders, enrichment: e, verification: v }))
    : null,
)

const out = results.filter(Boolean)
log(`Done: ${out.length}/${kept.length} companies enriched and verified`)
return { today: TODAY, rawRoleCount: allJobs.length, distinctCompanies: companies.length, dropped, companies: out }