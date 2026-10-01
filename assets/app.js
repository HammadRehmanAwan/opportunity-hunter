/* Opportunity Hunter: client-side app. No build step, no server, no tracking.
   Data comes from data/opportunities.js (generated from data/opportunities.json).
   Progress, notes, edited messages and your details live in localStorage. */
(() => {
  'use strict';

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  const KEYS = { tracker: 'oh:tracker:v1', profile: 'oh:profile:v1', theme: 'oh:theme', filters: 'oh:filters:v2' };
  const STAGES = [
    ['new', 'Not contacted'], ['shortlisted', 'Saved'], ['contacted', 'Contacted'], ['replied', 'Replied'],
    ['interviewing', 'Interviewing'], ['offer', 'Offer'], ['passed', 'Not interested'],
  ];
  const STATUS_LABEL = Object.fromEntries(STAGES);
  const ACTIVE = ['contacted', 'replied', 'interviewing', 'offer'];
  const EMAIL_STATUS = ['verified_public', 'pattern_guess'];
  const ROLE_LABEL = { hiring_manager: 'Hiring manager', fde_lead: 'Leads the FDE team', recruiter: 'Recruiter', founder: 'Founder or exec', team_member: 'Works on the team' };
  const DEFAULT_FILTERS = { q: '', region: 'any', remote: 'any', minScore: 1, status: 'any', sort: 'score', emailOnly: false, verifiedOnly: false };

  const load = (k, fallback) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode etc. */ } };
  const plain = (o) => Object.assign(Object.create(null), o && typeof o === 'object' ? o : {});

  const DEFAULT_PROFILE = Object.assign({
    name: 'Your name', email: 'you@example.com', phone: '', linkedin: '', cv_url: '', headline: '',
    mail_client: 'mailto', signature: '',
  }, window.OH_PROFILE || {});

  let DATA = Array.isArray(window.OH_DATA) ? window.OH_DATA : [];
  let META = window.OH_META || {};
  let tracker = plain(load(KEYS.tracker, {}));
  let profile = Object.assign({}, DEFAULT_PROFILE, load(KEYS.profile, {}));
  let filters = Object.assign({}, DEFAULT_FILTERS, load(KEYS.filters, {}));

  // ---------- helpers ----------
  const firstName = (n) => (n || '').trim().split(/\s+/)[0] || '';
  const initials = (n) => (n || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((t) => t[0]).join('').toUpperCase();
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isHttp = (u) => /^https?:\/\//i.test(u || '');
  const isEmail = (e) => /^[^\s@,;:<>?&"'()[\]\\]+@[^\s@,;:<>?&"'()[\]\\/]+\.[a-z]{2,}$/i.test(e || '');
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const nowIso = () => new Date().toISOString();
  const fmtDate = (iso) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };
  // Research notes use recruiter shorthand; say it in plain words.
  const say = (t) => String(t || '')
    .replace(/\breqs\b/gi, 'roles').replace(/\breq\b/gi, 'role').replace(/\bJDs?\b/g, 'job description')
    .replace(/\bATS\b/g, 'job board').replace(/\bFDEs\b/g, 'forward-deployed engineers').replace(/\bGTM\b/g, 'go-to-market')
    .replace(/\s+/g, ' ').trim();

  const ICON = {
    ext: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>',
    check: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>',
    alert: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5m0 3h.01M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
    pin: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    home: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
    li: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true" style="fill:currentColor;stroke:none"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z"/></svg>',
    pen: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/></svg>',
  };

  function toast(msg) {
    const t = $('#toast'); t.classList.add('show'); t.textContent = msg;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.classList.remove('show'); t.textContent = ''; }, 2800);
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      ta.remove(); return ok;
    }
  }

  function state(id) {
    if (!Object.hasOwn(tracker, id)) tracker[id] = { status: 'new', notes: '', drafts: {}, contact: 0 };
    const s = tracker[id]; if (!s.drafts || typeof s.drafts !== 'object') s.drafts = {}; return s;
  }
  function persist() { save(KEYS.tracker, tracker); }

  // The address to use for a contact: their published work email, else a likely one, else the careers inbox.
  function contactEmail(o, c) {
    if (c && isEmail(c.email)) return { email: c.email, status: EMAIL_STATUS.includes(c.email_status) ? c.email_status : 'unknown' };
    if (isEmail(o.careers_email)) return { email: o.careers_email, status: 'careers' };
    return { email: '', status: 'none' };
  }
  function emailPill(status) {
    if (status === 'verified_public') return `<span class="pill pill-ok" title="Seen published by the company or the person">${ICON.check}Public</span>`;
    if (status === 'careers') return '<span class="pill pill-ok" title="The company\'s published recruiting inbox">Careers inbox</span>';
    if (status === 'pattern_guess' || status === 'unknown') return `<span class="pill pill-warn" title="Follows the company's usual email format but wasn't seen published">${ICON.alert}Likely, check first</span>`;
    return '';
  }

  function fill(tpl, o, c) {
    const map = {
      first_name: firstName(c && c.name) || 'there',
      contact_name: (c && c.name) || '',
      contact_title: (c && c.title) || '',
      company: o.company || '',
      role: o.role_title || '',
      my_name: profile.name || '', my_first_name: firstName(profile.name), my_email: profile.email || '',
      my_linkedin: profile.linkedin || '', my_phone: profile.phone || '', my_cv: profile.cv_url || '', my_headline: profile.headline || '',
      signature: profile.signature || profile.name || '',
    };
    return String(tpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (Object.hasOwn(map, k) ? map[k] : m));
  }

  // Edited messages are stored per role AND per recipient, so switching person falls back to the template.
  function draft(o, key, field) {
    const s = state(o.id); const edited = s.drafts[key];
    if (edited && typeof edited[field] === 'string') return { text: edited[field], edited: true };
    return { text: (o.drafts && o.drafts[field]) || '', edited: false };
  }

  function mailLink(to, subject, body) {
    const enc = encodeURIComponent; const addr = isEmail(to) ? to : '';
    if (profile.mail_client === 'gmail') return `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(addr)}&su=${enc(subject)}&body=${enc(body)}`;
    if (profile.mail_client === 'outlook') return `https://outlook.office.com/mail/deeplink/compose?to=${enc(addr)}&subject=${enc(subject)}&body=${enc(body)}`;
    return `mailto:${addr}?subject=${enc(subject)}&body=${enc(body)}`;
  }
  const sendLabel = () => ({ gmail: 'Open in Gmail', outlook: 'Open in Outlook' }[profile.mail_client] || 'Open in your email app');

  // Navigation seam: tests (or a host page) can set window.OH_NAV(url, newTab) to observe navigations.
  const go = (url, newTab) => { if (typeof window.OH_NAV === 'function') return window.OH_NAV(url, newTab); if (newTab) window.open(url, '_blank', 'noopener'); else window.location.href = url; };

  // ---------- theme ----------
  function effectiveTheme() { return document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); }
  function applyTheme(t) {
    if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
    const b = $('#btn-theme'); if (b) { const eff = effectiveTheme(); b.setAttribute('aria-label', eff === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'); b.setAttribute('aria-pressed', String(eff === 'dark')); }
  }
  applyTheme(load(KEYS.theme, null));
  $('#btn-theme').addEventListener('click', () => { const next = effectiveTheme() === 'dark' ? 'light' : 'dark'; applyTheme(next); save(KEYS.theme, next); });

  // ---------- summary + progress ----------
  function renderSummary() {
    const total = DATA.length;
    const uk = DATA.filter((o) => o.region === 'UK').length;
    const people = DATA.reduce((n, o) => n + (o.contacts || []).length, 0);
    $('#lead').textContent = total
      ? `${total} open roles (${uk} in London and the UK), ${people} people hiring for them, and a message already written for each one.`
      : 'Open roles, the people hiring for them, and a message already written for each one.';
    const counts = Object.fromEntries(STAGES.map(([k]) => [k, 0]));
    DATA.forEach((o) => { const st = state(o.id).status; counts[Object.hasOwn(counts, st) ? st : 'new']++; });
    $('#stages').innerHTML = STAGES.map(([k, label]) => `<button type="button" class="stage${counts[k] ? '' : ' is-zero'}" data-stage="${k}" aria-pressed="${filters.status === k}"><span class="n">${counts[k]}</span><span class="k">${esc(label)}</span></button>`).join('');
    $$('.stage', $('#stages')).forEach((b) => b.addEventListener('click', () => {
      filters.status = filters.status === b.dataset.stage ? 'any' : b.dataset.stage;
      $('#f-status').value = filters.status; saveFilters(); renderSummary(); renderList();
    }));
    $('#foot-meta').textContent = META.generated_at ? `Researched ${fmtDate(META.generated_at)} · ${total} roles · ${people} people` : `${total} roles · ${people} people`;
  }

  // ---------- filtering ----------
  const regionMatch = (o) => filters.region === 'any' || o.region === filters.region || (filters.region === 'US' && (o.region === 'US' || o.region === 'Other'));
  function visible() {
    const q = filters.q.trim().toLowerCase();
    const rows = DATA.filter((o) => {
      const s = state(o.id);
      if (!regionMatch(o)) return false;
      if (filters.remote !== 'any' && (o.remote_policy || 'unknown').toLowerCase() !== filters.remote) return false;
      if (o.score != null && o.score < filters.minScore) return false;
      if (filters.status !== 'any' && s.status !== filters.status) return false;
      if (filters.emailOnly && !(isEmail(o.careers_email) || (o.contacts || []).some((c) => isEmail(c.email)))) return false;
      if (filters.verifiedOnly && !(o.contacts || []).some((c) => c.verified === true)) return false;
      if (q) {
        const hay = [o.company, o.role_title, o.location, o.rationale, o.what_they_do, ...(o.contacts || []).map((c) => `${c.name} ${c.title}`)].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const by = {
      score: (a, b) => (b.score || 0) - (a.score || 0) || a.company.localeCompare(b.company),
      company: (a, b) => a.company.localeCompare(b.company),
      contacts: (a, b) => (b.contacts || []).length - (a.contacts || []).length || (b.score || 0) - (a.score || 0),
      recent: (a, b) => (state(b.id).contacted_at || '').localeCompare(state(a.id).contacted_at || '') || (b.score || 0) - (a.score || 0),
    };
    return rows.sort(by[filters.sort] || by.score);
  }
  const saveFilters = () => save(KEYS.filters, filters);
  const activeExtraFilters = () => ['remote', 'minScore', 'status', 'emailOnly', 'verifiedOnly'].filter((k) => filters[k] !== DEFAULT_FILTERS[k]).length;

  function setFilterInputs() {
    const f = filters;
    $('#f-q').value = f.q; $('#f-remote').value = f.remote; $('#f-score').value = f.minScore; $('#f-score-out').value = f.minScore;
    $('#f-status').value = f.status; $('#f-sort').value = f.sort; $('#f-email').checked = f.emailOnly; $('#f-verified').checked = f.verifiedOnly;
    $$('#regions .chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.region === f.region)));
    const n = activeExtraFilters(); const more = $('#btn-more');
    more.lastChild.textContent = n ? `More filters (${n})` : 'More filters';
  }
  function bindFilters() {
    const f = filters; setFilterInputs();
    const upd = () => { saveFilters(); setFilterInputs(); renderSummary(); renderList(); };
    $('#f-q').addEventListener('input', (e) => { f.q = e.target.value; saveFilters(); renderList(); });
    $$('#regions .chip').forEach((c) => c.addEventListener('click', () => { f.region = c.dataset.region; upd(); }));
    $('#f-remote').addEventListener('change', (e) => { f.remote = e.target.value; upd(); });
    $('#f-score').addEventListener('input', (e) => { f.minScore = Number(e.target.value); $('#f-score-out').value = f.minScore; upd(); });
    $('#f-status').addEventListener('change', (e) => { f.status = e.target.value; upd(); });
    $('#f-sort').addEventListener('change', (e) => { f.sort = e.target.value; upd(); });
    $('#f-email').addEventListener('change', (e) => { f.emailOnly = e.target.checked; upd(); });
    $('#f-verified').addEventListener('change', (e) => { f.verifiedOnly = e.target.checked; upd(); });
    $('#btn-clear').addEventListener('click', () => { Object.assign(filters, DEFAULT_FILTERS); upd(); });
    const more = $('#btn-more'), panel = $('#more-filters');
    if (activeExtraFilters()) { panel.hidden = false; more.setAttribute('aria-expanded', 'true'); }
    more.addEventListener('click', () => { const open = panel.hidden; panel.hidden = !open; more.setAttribute('aria-expanded', String(open)); });
  }

  // ---------- rendering ----------
  const matchLabel = (n) => (n == null ? 'Not scored' : n >= 8 ? 'Great match' : n >= 6 ? 'Good match' : n >= 4 ? 'Worth a look' : 'Long shot');
  const scoreClass = (n) => (n == null ? 's-none' : n >= 8 ? 's-high' : n >= 6 ? 's-mid' : 's-low');
  const peopleSearchUrl = (o) => (isHttp(o.linkedin_people_search_url) ? o.linkedin_people_search_url : `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${o.company} forward deployed engineer OR recruiter OR head of engineering`)}`);
  const jobStatus = (o) => { const v = o.verification || {}; return v.job_status || (v.job_url_live === true ? 'listed_recently' : 'unconfirmed'); };
  const workLabel = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'In the office' };

  function renderList() {
    const rows = visible();
    const list = $('#list');
    $('#result-line').textContent = rows.length === DATA.length ? `Showing all ${rows.length} roles` : `Showing ${rows.length} of ${DATA.length} roles`;
    list.innerHTML = '';
    if (!DATA.length) { list.innerHTML = '<div class="empty">No roles loaded yet. Run <code>node scripts/build-data.mjs</code> to build <code>data/opportunities.js</code>.</div>'; return; }
    if (!rows.length) {
      list.innerHTML = '<div class="empty">No roles match these filters. <button type="button" class="btn btn-ghost btn-sm" id="empty-reset">Reset filters</button></div>';
      $('#empty-reset').addEventListener('click', () => $('#btn-clear').click());
      return;
    }
    const tpl = $('#tpl-card');
    const frag = document.createDocumentFragment();
    rows.forEach((o) => frag.appendChild(renderCard(o, tpl)));
    list.appendChild(frag);
  }

  function renderCard(o, tpl) {
    const s = state(o.id);
    const el = tpl.content.firstElementChild.cloneNode(true);
    el.dataset.id = o.id; el.dataset.status = s.status;
    const cid = slug(o.id);
    const contacts = o.contacts || [];
    const titleEl = $('.company', el); titleEl.id = `co-${cid}`; el.setAttribute('aria-labelledby', titleEl.id);

    // summary
    const sc = $('.score', el); sc.classList.add(scoreClass(o.score));
    $('.score-n', el).textContent = o.score ?? '–';
    $('.score-label', el).textContent = matchLabel(o.score);
    sc.setAttribute('aria-label', `${matchLabel(o.score)}, ${o.score ?? 'no'} out of 10`);
    titleEl.innerHTML = isHttp(o.company_url) ? `<a href="${esc(o.company_url)}" target="_blank" rel="noopener">${esc(o.company)}</a>` : esc(o.company);
    $('.role', el).textContent = o.role_title || '';

    const js = jobStatus(o);
    const chips = [];
    if (o.location) chips.push(`<span class="pill">${ICON.pin}${esc(o.location.length > 42 ? `${o.location.slice(0, 40).replace(/\s+\S*$/, '')}…` : o.location)}</span>`);
    if (workLabel[o.remote_policy]) chips.push(`<span class="pill">${ICON.home}${workLabel[o.remote_policy]}</span>`);
    chips.push({
      live_fetched: `<span class="pill pill-ok" title="The job page was open when checked">${ICON.check}Job is open</span>`,
      listed_recently: `<span class="pill pill-ok" title="Seen listed in the last few weeks">${ICON.check}Seen recently</span>`,
      closed: `<span class="pill pill-bad">${ICON.alert}May be closed</span>`,
    }[js] || `<span class="pill pill-warn" title="Not seen in the last few weeks. Open the job link before applying.">${ICON.alert}Check it's still open</span>`);
    $('.chips', el).innerHTML = chips.join('');
    $('.why-fit', el).textContent = o.fit_summary || say(o.rationale || o.summary || '');

    const job = $('.job-link', el);
    if (isHttp(o.job_url)) job.href = o.job_url;
    else job.replaceWith(Object.assign(document.createElement('span'), { className: 'pill pill-warn', textContent: 'No job link' }));

    const st = $('.status', el); st.value = s.status; st.setAttribute('aria-label', `Progress for ${o.company}`);
    st.addEventListener('change', () => {
      s.status = st.value; el.dataset.status = s.status;
      if (ACTIVE.includes(s.status) && !s.contacted_at) s.contacted_at = nowIso();
      persist(); renderSummary(); renderContactedLine(o, el); toast(`${o.company}: ${STATUS_LABEL[s.status]}`);
    });

    const best = contacts[0];
    $('.best-contact', el).innerHTML = best
      ? `Best first contact: <b>${esc(best.name)}</b>${best.title ? `, ${esc(best.title)}` : ''}${best.verified === true ? ` <span class="pill pill-ok">${ICON.check}Confirmed</span>` : ''}`
      : (isEmail(o.careers_email) ? `No named contact yet. Write to the careers inbox, <b>${esc(o.careers_email)}</b>.` : 'No named contact yet. Use the LinkedIn search in the details.');

    // details
    $('.rationale', el).textContent = o.fit_summary || say(o.rationale || '');
    const watch = Array.isArray(o.watch_outs) && o.watch_outs.length ? o.watch_outs : (o.fit_notes ? [say(o.fit_notes)] : []);
    if (watch.length) $('.caveats', el).innerHTML = watch.map((w) => `<li>${esc(w)}</li>`).join('');
    else $('.watch', el).remove();
    $('.raw', el).textContent = [o.rationale, o.fit_notes].filter(Boolean).join(' ');
    $('.team', el).textContent = say(o.fde_team_context || o.why_fde || '');
    $('.about', el).textContent = [o.what_they_do, o.hq, o.size_text].filter(Boolean).map(say).join(' ');
    const others = (o.other_roles || []).filter((r) => r && r.role_title);
    if (others.length) $('.also-open', el).innerHTML = others.map((r) => `<li>${isHttp(r.job_url) ? `<a href="${esc(r.job_url)}" target="_blank" rel="noopener">${esc(r.role_title)}</a>` : esc(r.role_title)}${r.location ? ` <span class="fine">· ${esc(r.location)}</span>` : ''}</li>`).join('');
    else $('.also', el).remove();
    $$('.fit h3', el).forEach((h) => { const p = h.nextElementSibling; if (p && p.tagName === 'P' && !p.textContent.trim()) { h.remove(); p.remove(); } });
    const v = o.verification || {};
    const srcs = (o.sources || []).filter(isHttp).slice(0, 2).map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener">source ${i + 1}</a>`).join(' · ');
    $('.job-note', el).innerHTML = [v.issues ? `Research note: ${esc(say(v.issues))}` : '', o.last_verified ? `Checked ${esc(fmtDate(o.last_verified))}` : '', srcs].filter(Boolean).join(' · ');

    const ul = $('.contacts', el);
    if (!contacts.length) ul.innerHTML = '<li class="fine">No named person found yet. Try the LinkedIn search below.</li>';
    contacts.forEach((c, i) => {
      const li = document.createElement('li'); li.className = `contact${i === 0 ? ' is-best' : ''}`;
      const em = isEmail(c.email) ? { email: c.email, status: EMAIL_STATUS.includes(c.email_status) ? c.email_status : 'unknown' } : null;
      li.innerHTML = `
        <div class="avatar" aria-hidden="true">${esc(initials(c.name))}</div>
        <div class="who">
          <div class="name">${esc(c.name)}${c.verified === true ? ` <span class="pill pill-ok" title="Search results show them at this company in this job">${ICON.check}Confirmed</span>` : ' <span class="pill" title="We could not check this, which does not mean it is wrong">Not confirmed</span>'}${i === 0 ? ' <span class="pill pill-accent">Start here</span>' : ''}</div>
          <div class="title">${esc(c.title)}${ROLE_LABEL[c.role_type] ? ` · ${ROLE_LABEL[c.role_type]}` : ''}</div>
          ${em ? `<div class="email"><a href="mailto:${esc(em.email)}">${esc(em.email)}</a>${emailPill(em.status)}</div>` : ''}
          ${c.why_them ? `<details><summary>Why contact them</summary><p>${esc(say(c.why_them))}</p></details>` : ''}
        </div>
        <div class="contact-actions">
          <button type="button" class="btn ${i === 0 ? 'btn-primary' : 'btn-ghost'} btn-sm act-pick" data-i="${i}" aria-label="Write to ${esc(c.name)} at ${esc(o.company)}">${ICON.pen}Write to ${esc(firstName(c.name))}</button>
          ${isHttp(c.linkedin_url) ? `<a class="btn btn-ghost btn-sm li-btn" href="${esc(c.linkedin_url)}" target="_blank" rel="noopener" aria-label="${esc(c.name)} on LinkedIn">${ICON.li}LinkedIn</a>` : ''}
          ${isHttp(c.evidence_url) && c.evidence_url !== c.linkedin_url ? `<a class="btn btn-link btn-sm" href="${esc(c.evidence_url)}" target="_blank" rel="noopener">Where we found them</a>` : ''}
        </div>`;
      ul.appendChild(li);
    });
    $('.people-search', el).innerHTML = [
      `<a href="${esc(peopleSearchUrl(o))}" target="_blank" rel="noopener">Find more people on LinkedIn</a>`,
      isHttp(o.linkedin_company_url) ? `<a href="${esc(o.linkedin_company_url)}" target="_blank" rel="noopener">Company on LinkedIn</a>` : '',
      isHttp(o.careers_url) ? `<a href="${esc(o.careers_url)}" target="_blank" rel="noopener">Careers page</a>` : '',
      isEmail(o.careers_email) ? `Careers inbox: <a href="mailto:${esc(o.careers_email)}">${esc(o.careers_email)}</a>` : '',
    ].filter(Boolean).join(' · ');

    // open / close panels
    const details = $('.details', el), composer = $('.composer', el);
    const btnDetails = $('.btn-details', el), btnWrite = $('.btn-write', el);
    const syncOpen = () => el.classList.toggle('is-open', !details.hidden || !composer.hidden);
    const toggleDetails = (open = details.hidden) => { details.hidden = !open; btnDetails.setAttribute('aria-expanded', String(open)); syncOpen(); };
    const openComposer = (focus) => {
      composer.hidden = false; btnWrite.setAttribute('aria-expanded', 'true'); syncOpen();
      composer.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (focus) $('.contact-pick', el).focus({ preventScroll: true });
    };
    const closeComposer = () => { composer.hidden = true; btnWrite.setAttribute('aria-expanded', 'false'); syncOpen(); btnWrite.focus({ preventScroll: true }); };
    btnDetails.addEventListener('click', () => toggleDetails());
    btnWrite.addEventListener('click', () => (composer.hidden ? openComposer(true) : closeComposer()));
    $('.btn-close-composer', el).addEventListener('click', closeComposer);
    $$('.act-pick', el).forEach((b) => b.addEventListener('click', () => {
      s.contact = Number(b.dataset.i); persist(); renderComposer(o, el); openComposer(true);
      toast(`Writing to ${contacts[s.contact].name}`);
    }));

    // tabs (ids + aria, once per card)
    $$('.tab', el).forEach((t) => { t.id = `tab-${cid}-${t.dataset.tab}`; t.setAttribute('aria-controls', `pane-${cid}-${t.dataset.tab}`); });
    $$('.pane', el).forEach((p) => { p.id = `pane-${cid}-${p.dataset.pane}`; p.setAttribute('role', 'tabpanel'); p.setAttribute('aria-labelledby', `tab-${cid}-${p.dataset.pane}`); });
    const selectTab = (t) => { $$('.tab', el).forEach((x) => { const on = x === t; x.classList.toggle('active', on); x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1; }); $$('.pane', el).forEach((p) => { p.hidden = p.dataset.pane !== t.dataset.tab; }); };
    $$('.tab', el).forEach((t) => t.addEventListener('click', () => selectTab(t)));
    $('.tabs', el).addEventListener('keydown', (e) => {
      const tabs = $$('.tab', el); const i = tabs.indexOf(document.activeElement); if (i < 0) return;
      const n = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
      if (n >= 0) { e.preventDefault(); tabs[n].focus(); selectTab(tabs[n]); }
    });
    selectTab($('.tab', el));
    $('.contact-pick', el).setAttribute('aria-label', `Who to send it to at ${o.company}`);
    $('.d-note', el).addEventListener('input', () => countNote(el));

    renderComposer(o, el);
    return el;
  }

  function countNote(el) { const n = $('.d-note', el).value.length; const c = $('.note-count', el); c.textContent = `${n} of 300 characters`; c.classList.toggle('over', n > 300); }

  function renderComposer(o, el) {
    const s = state(o.id);
    const contacts = o.contacts || [];
    const pick = $('.contact-pick', el);
    const opts = contacts.map((c, i) => `<option value="${i}">${esc(c.name)}${c.title ? `, ${esc(c.title)}` : ''}</option>`);
    if (isEmail(o.careers_email)) opts.push(`<option value="careers">Careers inbox (${esc(o.careers_email)})</option>`);
    if (!opts.length) opts.push('<option value="none">No named contact (add the address yourself)</option>');
    pick.innerHTML = opts.join('');
    pick.value = s.contact === 'careers' && isEmail(o.careers_email) ? 'careers' : (typeof s.contact === 'number' && contacts[s.contact] ? String(s.contact) : (contacts.length ? '0' : (isEmail(o.careers_email) ? 'careers' : 'none')));

    const key = () => pick.value;
    const current = () => (pick.value === 'careers' || pick.value === 'none') ? null : contacts[Number(pick.value)];
    const recipient = () => pick.value === 'careers' ? { email: o.careers_email, status: 'careers' } : (pick.value === 'none' ? { email: '', status: 'none' } : contactEmail(o, current()));

    const subj = $('.d-subject', el), body = $('.d-email', el), note = $('.d-note', el), inmail = $('.d-inmail', el), notes = $('.notes', el);
    const fields = { email_subject: subj, email_body: body, linkedin_note: note, linkedin_inmail: inmail };
    const label = $('.write-label', el);

    function refresh() {
      const r = recipient(); const c = current();
      const who = c ? `<span class="to-who"><b>${esc(c.name)}</b>${c.title ? `, ${esc(c.title)}` : ''}</span>` : `<span class="to-who"><b>${pick.value === 'careers' ? 'Careers inbox' : 'Nobody picked'}</b></span>`;
      const em = r.email ? `<span class="to-email"><span>${esc(r.email)}</span>${emailPill(r.status)}</span>` : '<span class="to-email"><span class="pill pill-warn">No email address. Use LinkedIn, or type one into your email app.</span></span>';
      $('.to-line', el).innerHTML = `${who}${em}`;
      $('.composer-title', el).textContent = c ? `Write to ${c.name}` : (pick.value === 'careers' ? `Write to ${o.company}'s careers inbox` : `Write to ${o.company}`);
      label.textContent = c ? `Write to ${firstName(c.name)}` : 'Write a message';
      $('.send-label', el).textContent = sendLabel();
    }
    function loadDrafts() {
      const c = current(); const k = key(); let anyEdited = false;
      Object.entries(fields).forEach(([f, input]) => { const d = draft(o, k, f); input.value = d.edited ? d.text : fill(d.text, o, c); anyEdited = anyEdited || d.edited; });
      notes.value = s.notes || '';
      $$('.act-reset', el).forEach((b) => { b.hidden = !anyEdited; });
      countNote(el); refresh();
    }

    pick.onchange = () => { s.contact = pick.value === 'careers' ? 'careers' : (pick.value === 'none' ? 0 : Number(pick.value)); persist(); loadDrafts(); };

    // Editing stores the edited text for this role + this person only.
    Object.entries(fields).forEach(([f, input]) => { input.oninput = () => { const k = key(); s.drafts[k] = s.drafts[k] || {}; s.drafts[k][f] = input.value; persist(); $$('.act-reset', el).forEach((b) => { b.hidden = false; }); }; });
    notes.oninput = () => { s.notes = notes.value; persist(); };

    $$('.act-reset', el).forEach((b) => { b.onclick = () => { const f = b.dataset.field; const k = key(); const d = s.drafts[k] || {}; if (f === 'email') { delete d.email_subject; delete d.email_body; } else if (f === 'note') delete d.linkedin_note; else delete d.linkedin_inmail; if (!Object.keys(d).length) delete s.drafts[k]; persist(); loadDrafts(); toast('Back to the original message'); }; });

    const markContacted = (via) => { if (s.status === 'new' || s.status === 'shortlisted') { s.status = 'contacted'; el.dataset.status = 'contacted'; $('.status', el).value = 'contacted'; } if (!s.contacted_at) s.contacted_at = nowIso(); if (!s.contacted_via) s.contacted_via = via; persist(); renderSummary(); renderContactedLine(o, el); };

    $('.act-send', el).onclick = () => {
      const r = recipient();
      go(mailLink(r.email, subj.value, body.value), profile.mail_client !== 'mailto');
      markContacted('email'); toast(r.email ? `Opening your email to ${r.email}. Marked as contacted.` : 'Opening your email. Add the address before sending.');
    };
    $('.act-copy-email', el).onclick = async () => { const ok = await copyText(`Subject: ${subj.value}\n\n${body.value}`); toast(ok ? 'Email copied' : 'Copy failed. Select the text and copy it yourself.'); };
    $$('.act-linkedin', el).forEach((b) => { b.onclick = async () => {
      const c = current(); const text = b.dataset.kind === 'note' ? note.value : inmail.value;
      const ok = await copyText(text);
      const hasProfile = c && isHttp(c.linkedin_url);
      go(hasProfile ? c.linkedin_url : peopleSearchUrl(o), true);
      markContacted('linkedin');
      toast(ok ? (hasProfile ? `Copied. Paste it on ${firstName(c.name)}'s LinkedIn profile.` : 'Copied. No profile link, so LinkedIn search opened.') : 'Copy failed, but LinkedIn opened.');
    }; });

    loadDrafts();
    renderContactedLine(o, el);
  }

  function renderContactedLine(o, el) {
    const s = state(o.id); const line = $('.contacted-line', el);
    line.textContent = s.contacted_at ? `Progress: ${STATUS_LABEL[s.status]} · first contacted ${fmtDate(s.contacted_at)}${s.contacted_via ? ` by ${s.contacted_via === 'linkedin' ? 'LinkedIn' : 'email'}` : ''}` : `Progress: ${STATUS_LABEL[s.status] || 'Not contacted'}`;
  }

  // ---------- your details drawer ----------
  const drawer = $('#drawer'), backdrop = $('#drawer-backdrop'), form = $('#profile-form');
  let lastFocus = null;
  const inertTargets = () => ['header.top', 'main', 'footer'].map((sel) => $(sel)).filter(Boolean);
  function fillForm() { Object.entries(profile).forEach(([k, v]) => { const f = form.elements[k]; if (f) f.value = v ?? ''; }); }
  function openDrawer() { fillForm(); lastFocus = document.activeElement; drawer.hidden = false; backdrop.hidden = false; inertTargets().forEach((n) => { n.inert = true; }); $('input[name="name"]', form).focus(); }
  function closeDrawer() { drawer.hidden = true; backdrop.hidden = true; inertTargets().forEach((n) => { n.inert = false; }); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  $('#btn-profile').addEventListener('click', openDrawer);
  $('#btn-drawer-close').addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !drawer.hidden) closeDrawer(); });
  drawer.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = $$('button, [href], input, select, textarea, label.file-btn', drawer).filter((n) => !n.disabled && n.offsetParent !== null);
    if (!f.length) return; const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); const fd = new FormData(form); profile = Object.assign({}, DEFAULT_PROFILE, Object.fromEntries(fd.entries())); save(KEYS.profile, profile); closeDrawer(); renderList(); toast('Saved. Messages you haven\'t edited now use these details.'); });
  $('#btn-profile-reset').addEventListener('click', () => { profile = Object.assign({}, DEFAULT_PROFILE); save(KEYS.profile, {}); fillForm(); renderList(); toast('Back to the default details'); });

  $('#btn-backup').addEventListener('click', () => download('opportunity-hunter-backup.json', JSON.stringify({ tracker, profile, exported_at: nowIso() }, null, 2), 'application/json'));
  $('#file-restore').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const j = JSON.parse(await f.text()); if (j.tracker && typeof j.tracker === 'object') tracker = plain(j.tracker); if (j.profile) profile = Object.assign({}, DEFAULT_PROFILE, j.profile); save(KEYS.tracker, tracker); save(KEYS.profile, profile); fillForm(); renderSummary(); renderList(); toast('Backup restored'); }
    catch (err) { toast('That file could not be read'); }
    e.target.value = '';
  });
  $('#btn-wipe').addEventListener('click', () => { if (confirm('Clear all progress, notes and edited messages in this browser?')) { tracker = plain({}); save(KEYS.tracker, tracker); renderSummary(); renderList(); toast('Cleared'); } });

  // ---------- export ----------
  function csvCell(v) { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
  function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
  const exportCsv = () => {
    const head = ['company', 'role', 'location', 'region', 'remote', 'score', 'status', 'first_contact', 'job_url', 'contact_name', 'contact_title', 'contact_role', 'contact_verified', 'linkedin_url', 'email', 'email_status', 'careers_email', 'email_pattern', 'rationale', 'outreach_angle', 'notes'];
    const rows = [head.join(',')];
    visible().forEach((o) => {
      const s = state(o.id); const cs = (o.contacts && o.contacts.length) ? o.contacts : [{}];
      cs.forEach((c) => rows.push([o.company, o.role_title, o.location, o.region, o.remote_policy, o.score, s.status, s.contacted_at || '', o.job_url, c.name, c.title, c.role_type, c.verified === true ? 'yes' : 'no', c.linkedin_url, c.email, c.email_status, o.careers_email, o.email_pattern, o.rationale, o.outreach_angle, s.notes].map(csvCell).join(',')));
    });
    download('opportunity-hunter.csv', rows.join('\n'), 'text/csv'); toast(`Downloaded ${rows.length - 1} rows`);
  };
  $('#btn-export').addEventListener('click', exportCsv);
  $('#btn-export-2').addEventListener('click', exportCsv);

  // ---------- boot ----------
  async function boot() {
    if (!DATA.length && location.protocol !== 'file:') {
      try { const r = await fetch('data/opportunities.json', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); DATA = Array.isArray(j.opportunities) ? j.opportunities : []; META = j.meta || {}; } } catch (e) { /* no data */ }
    }
    DATA = DATA.filter((o) => o && typeof o === 'object' && o.company);
    DATA.forEach((o) => { if (!o.id) o.id = slug(`${o.company} ${o.role_title || ''}`); });
    bindFilters(); renderSummary(); renderList();
  }
  boot();
})();
