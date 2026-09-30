// Fixture used by `node scripts/smoke-test.mjs --fixture` — fictional companies.
window.OH_META = { generated_at: "2026-09-30T00:00:00Z" };
window.OH_PROFILE = { name: "Fixture Person", email: "fixture@example.com", linkedin: "https://www.linkedin.com/in/fixture/", cv_url: "https://example.com/cv", headline: "AI engineer", mail_client: "mailto", signature: "Fixture Person" };
window.OH_DATA = [
  { id: "acme-1", company: "Acme Deploy", company_url: "https://example.com", role_title: "Forward Deployed Engineer", location: "London, UK", region: "UK", remote_policy: "hybrid", job_url: "https://example.com/jobs/1", score: 9, rationale: "Great fit.", why_fde: "Embeds with customers.", suggested_contact: "Head of FDE", outreach_angle: "n8n + Claude work", careers_email: "careers@example.com",
    contacts: [ { name: "Jane Example", title: "Head of Forward Deployed Engineering", role_type: "hiring_manager", linkedin_url: "https://www.linkedin.com/in/jane-example/", email: "jane@example.com", email_status: "verified_public", verified: true, why_them: "Runs the team." } ],
    drafts: { email_subject: "FDE at {{company}} — {{my_name}}", email_body: "Hi {{first_name}},\n\nI'm {{my_name}}, {{my_headline}}.\n\n{{signature}}", linkedin_note: "Hi {{first_name}} — {{my_first_name}} here, London AI engineer; would love to chat about the {{role}} role at {{company}}.", linkedin_inmail: "Hi {{first_name}},\n\nLonger message about {{company}}.\n\n{{my_name}}" },
    verification: { job_url_live: true, overall_confidence: "high", issues: "" }, sources: ["https://example.com/jobs/1"], last_verified: "2026-09-30" },
  { id: "beta-2", company: "Beta Labs", role_title: "Deployed AI Engineer", location: "Remote (EMEA)", region: "Remote", remote_policy: "remote", job_url: "https://example.org/jobs/2", score: 6, rationale: "Decent fit.", why_fde: "Customer-embedded.", suggested_contact: "Recruiter",
    contacts: [],
    drafts: { email_subject: "{{role}} at {{company}}", email_body: "Hello,\n\n{{my_name}} here.\n\n{{signature}}", linkedin_note: "Hi — keen on {{company}}.", linkedin_inmail: "Hi,\n\nMessage.\n\n{{my_name}}" },
    verification: { job_url_live: false, overall_confidence: "medium", issues: "Posting date not shown" }, sources: [], last_verified: "2026-09-30" },
  { id: "gamma-3", company: "Gamma <img src=x onerror=\"document.body.insertAdjacentHTML('beforeend','<i id=xss-canary></i>')\">", role_title: "=HYPERLINK(\"http://evil\")", location: "Austin, US", region: "US", remote_policy: "onsite", job_url: "javascript:alert(1)", score: 4, rationale: "Low fit.", why_fde: "Onsite US.", suggested_contact: "Recruiter", careers_email: "not-an-email",
    contacts: [ { name: "Bob <b>Bold</b>", title: "Recruiter", role_type: "recruiter", linkedin_url: "javascript:alert(2)", email: "bob@example.net", email_status: "<img src=x onerror=\"document.body.insertAdjacentHTML('beforeend','<i id=xss-canary></i>')\">", verified: "false", why_them: "Posts roles." } ],
    linkedin_people_search_url: "javascript:alert(3)",
    drafts: { email_subject: "{{role}} at {{company}}", email_body: "Hi {{first_name}},\n\n{{my_name}} here.\n\n{{signature}}", linkedin_note: "Hi {{first_name}} — keen on {{company}}.", linkedin_inmail: "Hi,\n\nMessage.\n\n{{my_name}}" },
    verification: { job_url_live: "false", overall_confidence: "low", issues: "" }, sources: ["javascript:alert(4)"], last_verified: "2026-09-30" }
];
