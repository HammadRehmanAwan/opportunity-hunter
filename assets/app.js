/* Opportunity Hunter — client-side app. No build step, no server, no tracking.
   Data comes from data/opportunities.js (generated from data/opportunities.json).
   Tracker state (status, notes, edited drafts) and your profile live in localStorage. */
(() => {
  'use strict';

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  const KEYS = { tracker: 'oh:tracker:v1', profile: 'oh:profile:v1', theme: 'oh:theme', filters: 'oh:filters:v1' };
  const STATUS_LABEL = { new: 'New', shortlisted: 'Shortlisted', contacted: 'Contacted', replied: 'Replied', interviewing: 'Interviewing', offer: 'Offer', passed: 'Passed / rejected' };
  const ACTIVE = ['contacted', 'replied', 'interviewing', 'offer'];
  const EMAIL_STATUS = ['verified_public', 'pattern_guess'];

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
  let filters = Object.assign({ q: '', region: 'any', remote: 'any', minScore: 1, status: 'any', sort: 'score', emailOnly: false, verifiedOnly: false }, load(KEYS.filters, {}));

  // ---------- helpers ----------
  const firstName = (n) => (n || '').trim().split(/\s+/)[0] || '';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isHttp = (u) => /^https?:\/\//i.test(u || '');
  const isEmail = (e) => /^[^\s@,;:<>?&"'()[\]\\]+@[^\s@,;:<>?&"'()[\]\\/]+\.[a-z]{2,}$/i.test(e || '');
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const nowIso = () => new Date().toISOString();
  const fmtDate = (iso) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };

  function toast(msg) {
    const t = $('#toast'); t.classList.add('show'); t.textContent = msg;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.classList.remove('show'); t.textContent = ''; }, 2600);
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

  // Picks the email to use for a contact: their own published address, else a pattern guess, else the careers inbox.
  function contactEmail(o, c) {
    if (c && isEmail(c.email)) return { email: c.email, status: EMAIL_STATUS.includes(c.email_status) ? c.email_status : 'unknown', source: c.email_source_url || '' };
    if (isEmail(o.careers_email)) return { email: o.careers_email, status: 'careers', source: o.careers_email_source_url || '' };
    return { email: '', status: 'none', source: '' };
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

  // Edited drafts are stored per opportunity AND per recipient key, so switching contact falls back to the template.
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

  // ---------- stats ----------
  function renderStats() {
    const total = DATA.length;
    const uk = DATA.filter((o) => o.region === 'UK').length;
    const remote = DATA.filter((o) => o.region === 'Remote' || (o.remote_policy || '').toLowerCase() === 'remote').length;
    const contacts = DATA.reduce((n, o) => n + (o.contacts || []).length, 0);
    const emails = DATA.reduce((n, o) => n + (o.contacts || []).filter((c) => isEmail(c.email)).length + (isEmail(o.careers_email) ? 1 : 0), 0);
    const contacted = DATA.filter((o) => ACTIVE.includes(state(o.id).status)).length;
    $('#stats').innerHTML = [
      ['Open roles', total, ''], ['UK / London', uk, `+${remote} remote`], ['People to approach', contacts, ''], ['Email addresses', emails, ''], ['Contacted', contacted, `of ${total}`],
    ].map(([k, v, s]) => `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${esc(v)}${s ? `<small>${esc(s)}</small>` : ''}</div></div>`).join('');
    $('#foot-meta').textContent = META.generated_at ? `Research run ${fmtDate(META.generated_at)} · ${total} roles · ${contacts} contacts` : `${total} roles · ${contacts} contacts`;
  }

  // ---------- filtering ----------
  function visible() {
    const q = filters.q.trim().toLowerCase();
    const rows = DATA.filter((o) => {
      const s = state(o.id);
      if (filters.region !== 'any' && o.region !== filters.region) return false;
      if (filters.remote !== 'any' && (o.remote_policy || 'unknown').toLowerCase() !== filters.remote) return false;
      if (o.score != null && o.score < filters.minScore) return false;
      if (filters.status !== 'any' && s.status !== filters.status) return false;
      if (filters.emailOnly && !(isEmail(o.careers_email) || (o.contacts || []).some((c) => isEmail(c.email)))) return false;
      if (filters.verifiedOnly && !(o.contacts || []).some((c) => c.verified === true)) return false;
      if (q) {
        const hay = [o.company, o.role_title, o.location, o.summary, o.rationale, o.outreach_angle, o.what_they_do, ...(o.contacts || []).map((c) => `${c.name} ${c.title}`)].join(' ').toLowerCase();
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

  function setFilterInputs() {
    const f = filters;
    $('#f-q').value = f.q; $('#f-region').value = f.region; $('#f-remote').value = f.remote; $('#f-score').value = f.minScore; $('#f-score-out').value = f.minScore;
    $('#f-status').value = f.status; $('#f-sort').value = f.sort; $('#f-email').checked = f.emailOnly; $('#f-verified').checked = f.verifiedOnly;
  }
  function bindFilters() {
    const f = filters; setFilterInputs();
    const upd = () => { save(KEYS.filters, filters); renderList(); };
    $('#f-q').addEventListener('input', (e) => { f.q = e.target.value; upd(); });
    $('#f-region').addEventListener('change', (e) => { f.region = e.target.value; upd(); });
    $('#f-remote').addEventListener('change', (e) => { f.remote = e.target.value; upd(); });
    $('#f-score').addEventListener('input', (e) => { f.minScore = Number(e.target.value); $('#f-score-out').value = f.minScore; upd(); });
    $('#f-status').addEventListener('change', (e) => { f.status = e.target.value; upd(); });
    $('#f-sort').addEventListener('change', (e) => { f.sort = e.target.value; upd(); });
    $('#f-email').addEventListener('change', (e) => { f.emailOnly = e.target.checked; upd(); });
    $('#f-verified').addEventListener('change', (e) => { f.verifiedOnly = e.target.checked; upd(); });
    $('#btn-clear').addEventListener('click', () => { Object.assign(filters, { q: '', region: 'any', remote: 'any', minScore: 1, status: 'any', sort: 'score', emailOnly: false, verifiedOnly: false }); setFilterInputs(); upd(); });
  }

  // ---------- rendering ----------
  const LI_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z"/></svg>';

  function scoreClass(n) { return n == null ? 's-none' : n >= 8 ? 's-high' : n >= 6 ? 's-mid' : 's-low'; }
  function peopleSearchUrl(o) { return isHttp(o.linkedin_people_search_url) ? o.linkedin_people_search_url : `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${o.company} forward deployed engineer OR recruiter OR head of engineering`)}`; }

  function renderList() {
    const rows = visible();
    const list = $('#list');
    $('#result-line').textContent = `${rows.length} of ${DATA.length} opportunities`;
    list.innerHTML = '';
    if (!DATA.length) { list.innerHTML = '<div class="empty">No data loaded. Run <code>node scripts/build-data.mjs</code> to generate <code>data/opportunities.js</code>.</div>'; return; }
    if (!rows.length) { list.innerHTML = '<div class="empty">Nothing matches these filters.</div>'; return; }
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
    const titleEl = $('.company', el); titleEl.id = `co-${cid}`; el.setAttribute('aria-labelledby', titleEl.id);

    $('.score', el).classList.add(scoreClass(o.score)); $('.score-n', el).textContent = o.score ?? '–';
    titleEl.innerHTML = isHttp(o.company_url) ? `<a href="${esc(o.company_url)}" target="_blank" rel="noopener">${esc(o.company)}</a>` : esc(o.company);
    $('.role', el).textContent = o.role_title || '';
    $('.meta', el).innerHTML = [o.location, o.remote_policy && o.remote_policy !== 'unknown' ? o.remote_policy : '', o.employment_type, o.salary_text, o.posted_or_seen ? `seen ${o.posted_or_seen}` : '']
      .filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join('');

    const job = $('.job-link', el);
    if (isHttp(o.job_url)) job.href = o.job_url; else job.replaceWith(Object.assign(document.createElement('span'), { className: 'tag tag-warn', textContent: 'No live link' }));

    const st = $('.status', el); st.value = s.status; st.setAttribute('aria-label', `Status for ${o.company}`);
    st.addEventListener('change', () => {
      s.status = st.value; el.dataset.status = s.status;
      if (ACTIVE.includes(s.status) && !s.contacted_at) s.contacted_at = nowIso();
      persist(); renderStats(); renderContactedLine(o, el); toast(`${o.company}: ${STATUS_LABEL[s.status]}`);
    });

    $('.rationale', el).textContent = o.rationale || o.summary || '';
    $('.why-fde', el).textContent = o.why_fde || '';
    $('.suggested', el).textContent = o.suggested_contact || '';
    $('.angle', el).textContent = o.outreach_angle || '';
    $('.team', el).textContent = o.fde_team_context || '';
    $('.about', el).textContent = [o.what_they_do, o.hq, o.size_text].filter(Boolean).join(' · ');
    $('.caveats', el).textContent = o.fit_notes || '';
    const others = (o.other_roles || []).filter((r) => r && r.role_title);
    $('.also-open', el).innerHTML = others.map((r) => isHttp(r.job_url) ? `<a href="${esc(r.job_url)}" target="_blank" rel="noopener">${esc(r.role_title)}${r.location ? ` (${esc(r.location)})` : ''} ↗</a>` : `${esc(r.role_title)}${r.location ? ` (${esc(r.location)})` : ''}`).join(' · ');
    $$('.kv div', el).forEach((d) => { if (!$('dd', d).textContent.trim()) d.remove(); });

    const tags = [];
    if (o.region) tags.push(['tag-accent', o.region]);
    if (o.company_type) tags.push(['', o.company_type]);
    (o.tags || []).forEach((t) => tags.push(['', t]));
    if (o.verification) {
      const v = o.verification;
      const js = v.job_status || (v.job_url_live === true ? 'listed_recently' : 'unconfirmed');
      tags.push({ live_fetched: ['tag-ok', 'job page checked live'], listed_recently: ['tag-ok', 'listing seen recently'], unconfirmed: ['tag-warn', 'listing unconfirmed'], closed: ['tag-bad', 'posting may be closed'] }[js] || ['tag-warn', 'listing unconfirmed']);
      if (v.checked === false) tags.push(['tag-warn', 'not re-checked']);
      else if (v.overall_confidence) tags.push([v.overall_confidence === 'high' ? 'tag-ok' : v.overall_confidence === 'low' ? 'tag-bad' : 'tag-warn', `${v.overall_confidence} confidence`]);
    }
    if (o.email_pattern) tags.push(['tag-wrap', `pattern ${o.email_pattern}${o.email_pattern_confidence ? ` (${o.email_pattern_confidence})` : ''}`]);
    $('.tags', el).innerHTML = tags.map(([c, t]) => `<span class="tag ${c}">${esc(t)}</span>`).join('');

    const vl = $('.verify-line', el);
    const src = (o.sources || []).filter(isHttp).slice(0, 3).map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener">source ${i + 1}</a>`).join(' · ');
    vl.innerHTML = [o.last_verified ? `verified ${esc(o.last_verified)}` : '', o.verification && o.verification.issues ? esc(o.verification.issues) : '', src].filter(Boolean).join(' · ');
    if (!vl.innerHTML) vl.remove();

    // contacts
    const ul = $('.contacts', el);
    const contacts = o.contacts || [];
    if (!contacts.length) ul.innerHTML = '<li class="fine">No named contact confirmed yet — use the people search below or the careers inbox.</li>';
    contacts.forEach((c, i) => {
      const li = document.createElement('li'); li.className = 'contact';
      const em = contactEmail(o, c);
      const emailHtml = isEmail(c.email)
        ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a> <span class="tag ${c.email_status === 'verified_public' ? 'tag-ok' : 'tag-guess'}">${c.email_status === 'verified_public' ? 'published' : 'guess'}</span>${isHttp(c.email_source_url) ? ` <a class="fine" href="${esc(c.email_source_url)}" target="_blank" rel="noopener">src</a>` : ''}`
        : (em.email ? `<span class="fine">no personal email · use ${esc(em.email)}</span>` : '<span class="fine">no email found</span>');
      li.innerHTML = `
        <div class="who">
          <div class="name">${esc(c.name)} ${c.verified === true ? '<span class="verified" title="Title and profile re-checked">✓ verified</span>' : '<span class="unverified" title="Could not be independently re-checked">unverified</span>'}</div>
          <div class="title">${esc(c.title)}${c.role_type ? ` · <span class="tag">${esc(String(c.role_type).replace(/_/g, ' '))}</span>` : ''}</div>
          ${c.why_them ? `<div class="why">${esc(c.why_them)}</div>` : ''}
          <div class="email">${emailHtml}</div>
        </div>
        <div class="links">
          ${isHttp(c.linkedin_url) ? `<a class="li-btn" href="${esc(c.linkedin_url)}" target="_blank" rel="noopener">${LI_ICON}LinkedIn</a>` : '<span class="fine">no profile link</span>'}
          ${isHttp(c.evidence_url) ? `<a class="fine" href="${esc(c.evidence_url)}" target="_blank" rel="noopener">evidence ↗</a>` : ''}
          <button type="button" class="btn btn-ghost btn-sm act-pick" data-i="${i}" aria-label="Draft outreach to ${esc(c.name)} at ${esc(o.company)}">Draft to ${esc(firstName(c.name))}</button>
        </div>`;
      ul.appendChild(li);
    });
    $$('.act-pick', el).forEach((b) => b.addEventListener('click', () => {
      s.contact = Number(b.dataset.i); persist(); renderOutreach(o, el);
      const det = $('.outreach', el); det.open = true; det.scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('.contact-pick', el).focus({ preventScroll: true }); toast(`Drafts switched to ${contacts[s.contact].name}`);
    }));

    const ps = $('.people-search', el);
    ps.innerHTML = `Find more: <a href="${esc(peopleSearchUrl(o))}" target="_blank" rel="noopener">LinkedIn people search ↗</a>${isHttp(o.linkedin_company_url) ? ` · <a href="${esc(o.linkedin_company_url)}" target="_blank" rel="noopener">company page ↗</a>` : ''}${isHttp(o.careers_url) ? ` · <a href="${esc(o.careers_url)}" target="_blank" rel="noopener">careers ↗</a>` : ''}${isEmail(o.careers_email) ? ` · careers inbox <a href="mailto:${esc(o.careers_email)}">${esc(o.careers_email)}</a>` : ''}`;

    // tabs: ids + aria wiring (once per card)
    $$('.tab', el).forEach((t) => { t.id = `tab-${cid}-${t.dataset.tab}`; t.setAttribute('aria-controls', `pane-${cid}-${t.dataset.tab}`); });
    $$('.pane', el).forEach((p) => { p.id = `pane-${cid}-${p.dataset.pane}`; p.setAttribute('role', 'tabpanel'); p.setAttribute('aria-labelledby', `tab-${cid}-${p.dataset.pane}`); });
    const selectTab = (t) => { $$('.tab', el).forEach((x) => { const on = x === t; x.classList.toggle('active', on); x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1; }); $$('.pane', el).forEach((p) => { p.hidden = p.dataset.pane !== t.dataset.tab; }); };
    $$('.tab', el).forEach((t) => { t.addEventListener('click', () => selectTab(t)); });
    $('.tabs', el).addEventListener('keydown', (e) => {
      const tabs = $$('.tab', el); const i = tabs.indexOf(document.activeElement); if (i < 0) return;
      const n = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
      if (n >= 0) { e.preventDefault(); tabs[n].focus(); selectTab(tabs[n]); }
    });
    selectTab($('.tab', el));
    $('.contact-pick', el).setAttribute('aria-label', `Send to (${o.company})`);
    $('.d-note', el).addEventListener('input', () => countNote(el));

    renderOutreach(o, el);
    return el;
  }

  function countNote(el) { const note = $('.d-note', el); const n = note.value.length; const c = $('.note-count', el); c.textContent = `${n}/300`; c.classList.toggle('over', n > 300); }

  function renderOutreach(o, el) {
    const s = state(o.id);
    const contacts = o.contacts || [];
    const pick = $('.contact-pick', el);
    const opts = contacts.map((c, i) => `<option value="${i}">${esc(c.name)} — ${esc(c.title)}</option>`);
    if (isEmail(o.careers_email)) opts.push(`<option value="careers">Careers inbox — ${esc(o.careers_email)}</option>`);
    if (!opts.length) opts.push('<option value="none">No contact — fill in the address yourself</option>');
    pick.innerHTML = opts.join('');
    const cur = s.contact === 'careers' && isEmail(o.careers_email) ? 'careers' : (typeof s.contact === 'number' && contacts[s.contact] ? String(s.contact) : (contacts.length ? '0' : (isEmail(o.careers_email) ? 'careers' : 'none')));
    pick.value = cur;

    const key = () => pick.value;
    const current = () => (pick.value === 'careers' || pick.value === 'none') ? null : contacts[Number(pick.value)];
    const recipient = () => pick.value === 'careers' ? { email: o.careers_email, status: 'careers' } : (pick.value === 'none' ? { email: '', status: 'none' } : contactEmail(o, current()));

    const subj = $('.d-subject', el), body = $('.d-email', el), note = $('.d-note', el), inmail = $('.d-inmail', el), notes = $('.notes', el);
    const toLine = $('.to-line', el);
    const fields = { email_subject: subj, email_body: body, linkedin_note: note, linkedin_inmail: inmail };

    function refreshToLine() {
      const r = recipient(); const c = current();
      const who = c ? `<b>${esc(c.name)}</b> · ${esc(c.title)}` : (pick.value === 'careers' ? '<b>Careers inbox</b>' : '<b>No recipient selected</b>');
      const label = { verified_public: 'published', careers: 'careers inbox', pattern_guess: 'guess — verify first', unknown: 'unlabelled — verify first' }[r.status] || esc(r.status);
      const cls = r.status === 'verified_public' || r.status === 'careers' ? 'tag-ok' : r.status === 'pattern_guess' || r.status === 'unknown' ? 'tag-guess' : '';
      const em = r.email ? `${esc(r.email)} <span class="tag ${cls}">${label}</span>` : '<span class="tag tag-warn">no email — the mail button opens a blank “to”</span>';
      toLine.innerHTML = `${who}<br>${em}`;
    }
    function loadDrafts() {
      const c = current(); const k = key(); let anyEdited = false;
      Object.entries(fields).forEach(([f, input]) => { const d = draft(o, k, f); input.value = d.edited ? d.text : fill(d.text, o, c); anyEdited = anyEdited || d.edited; });
      notes.value = s.notes || '';
      $$('.act-reset', el).forEach((b) => { b.hidden = !anyEdited; });
      countNote(el); refreshToLine();
    }

    pick.onchange = () => { s.contact = pick.value === 'careers' ? 'careers' : (pick.value === 'none' ? 0 : Number(pick.value)); persist(); loadDrafts(); };

    // Editing a draft stores the edited text for this opportunity + recipient only.
    Object.entries(fields).forEach(([f, input]) => { input.oninput = () => { const k = key(); s.drafts[k] = s.drafts[k] || {}; s.drafts[k][f] = input.value; persist(); $$('.act-reset', el).forEach((b) => { b.hidden = false; }); }; });
    notes.oninput = () => { s.notes = notes.value; persist(); };

    $$('.act-reset', el).forEach((b) => { b.onclick = () => { const f = b.dataset.field; const k = key(); const d = s.drafts[k] || {}; if (f === 'email') { delete d.email_subject; delete d.email_body; } else if (f === 'note') delete d.linkedin_note; else delete d.linkedin_inmail; if (!Object.keys(d).length) delete s.drafts[k]; persist(); loadDrafts(); toast('Draft reset'); }; });

    const markContacted = (via) => { if (s.status === 'new' || s.status === 'shortlisted') { s.status = 'contacted'; el.dataset.status = 'contacted'; $('.status', el).value = 'contacted'; } if (!s.contacted_at) s.contacted_at = nowIso(); if (!s.contacted_via) s.contacted_via = via; persist(); renderStats(); renderContactedLine(o, el); };

    $('.act-send', el).onclick = () => {
      const r = recipient();
      const url = mailLink(r.email, subj.value, body.value);
      go(url, profile.mail_client !== 'mailto');
      markContacted('email'); toast(r.email ? `Opening email to ${r.email}` : 'Opening email — add the address');
    };
    $('.act-copy-email', el).onclick = async () => { const ok = await copyText(`Subject: ${subj.value}\n\n${body.value}`); toast(ok ? 'Email copied' : 'Copy failed — select the text manually'); };
    $$('.act-linkedin', el).forEach((b) => { b.onclick = async () => {
      const c = current(); const text = b.dataset.kind === 'note' ? note.value : inmail.value;
      const ok = await copyText(text);
      const url = (c && isHttp(c.linkedin_url)) ? c.linkedin_url : peopleSearchUrl(o);
      go(url, true);
      markContacted('linkedin');
      toast(ok ? (c && isHttp(c.linkedin_url) ? `Copied — paste it on ${firstName(c.name)}'s profile` : 'Copied — no profile link, opened people search') : 'Copy failed — opened LinkedIn anyway');
    }; });

    loadDrafts();
    renderContactedLine(o, el);
  }

  function renderContactedLine(o, el) {
    const s = state(o.id); const line = $('.contacted-line', el);
    line.textContent = s.contacted_at ? `Status: ${STATUS_LABEL[s.status]} · first contact ${fmtDate(s.contacted_at)}${s.contacted_via ? ` via ${s.contacted_via}` : ''}` : `Status: ${STATUS_LABEL[s.status] || 'New'}`;
  }

  // ---------- profile drawer ----------
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
  form.addEventListener('submit', (e) => { e.preventDefault(); const fd = new FormData(form); profile = Object.assign({}, DEFAULT_PROFILE, Object.fromEntries(fd.entries())); save(KEYS.profile, profile); closeDrawer(); renderList(); toast('Profile saved — unedited drafts updated'); });
  $('#btn-profile-reset').addEventListener('click', () => { profile = Object.assign({}, DEFAULT_PROFILE); save(KEYS.profile, {}); fillForm(); renderList(); toast('Profile reset'); });

  $('#btn-backup').addEventListener('click', () => download('opportunity-hunter-tracker.json', JSON.stringify({ tracker, profile, exported_at: nowIso() }, null, 2), 'application/json'));
  $('#file-restore').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const j = JSON.parse(await f.text()); if (j.tracker && typeof j.tracker === 'object') tracker = plain(j.tracker); if (j.profile) profile = Object.assign({}, DEFAULT_PROFILE, j.profile); save(KEYS.tracker, tracker); save(KEYS.profile, profile); fillForm(); renderList(); renderStats(); toast('Tracker restored'); }
    catch (err) { toast('Could not read that file'); }
    e.target.value = '';
  });
  $('#btn-wipe').addEventListener('click', () => { if (confirm('Clear all statuses, notes and edited drafts in this browser?')) { tracker = plain({}); save(KEYS.tracker, tracker); renderList(); renderStats(); toast('Tracker cleared'); } });

  // ---------- export ----------
  function csvCell(v) { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
  function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
  $('#btn-export').addEventListener('click', () => {
    const head = ['company', 'role', 'location', 'region', 'remote', 'score', 'status', 'first_contact', 'job_url', 'contact_name', 'contact_title', 'contact_role', 'contact_verified', 'linkedin_url', 'email', 'email_status', 'careers_email', 'email_pattern', 'rationale', 'outreach_angle', 'notes'];
    const rows = [head.join(',')];
    visible().forEach((o) => {
      const s = state(o.id); const cs = (o.contacts && o.contacts.length) ? o.contacts : [{}];
      cs.forEach((c) => rows.push([o.company, o.role_title, o.location, o.region, o.remote_policy, o.score, s.status, s.contacted_at || '', o.job_url, c.name, c.title, c.role_type, c.verified === true ? 'yes' : 'no', c.linkedin_url, c.email, c.email_status, o.careers_email, o.email_pattern, o.rationale, o.outreach_angle, s.notes].map(csvCell).join(',')));
    });
    download('opportunity-hunter.csv', rows.join('\n'), 'text/csv'); toast(`Exported ${rows.length - 1} rows`);
  });

  // ---------- boot ----------
  async function boot() {
    if (!DATA.length && location.protocol !== 'file:') {
      try { const r = await fetch('data/opportunities.json', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); DATA = Array.isArray(j.opportunities) ? j.opportunities : []; META = j.meta || {}; } } catch (e) { /* no data */ }
    }
    DATA = DATA.filter((o) => o && typeof o === 'object' && o.company);
    DATA.forEach((o) => { if (!o.id) o.id = slug(`${o.company} ${o.role_title || ''}`); });
    bindFilters(); renderStats(); renderList();
  }
  boot();
})();
