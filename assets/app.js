/* Opportunity Hunter: client-side app. No build step, no server, no tracking.
   Data comes from data/opportunities.js (generated from data/opportunities.json).
   Progress, notes, edited messages and your details live in localStorage. Opened as a claude.ai
   artifact, they are also saved to the viewer's own private space in the artifact's db. */
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
  const asObj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

  if (!document.documentElement.lang) document.documentElement.lang = 'en';

  // Set when the page is open inside the claude.ai artifact viewer.
  const HOST = window.claude && typeof window.claude.use === 'function' ? window.claude : null;

  // Saved progress and details come from this browser, a backup file or the account, so each
  // entry is rebuilt from known fields with the expected types before the page uses it.
  const PROFILE_KEYS = ['name', 'email', 'phone', 'linkedin', 'cv_url', 'headline', 'mail_client', 'signature'];
  const MAIL_CLIENTS = ['mailto', 'gmail', 'outlook'];
  const DRAFT_FIELDS = ['email_subject', 'email_body', 'linkedin_note', 'linkedin_inmail'];
  function cleanProfile(v) {
    const p = asObj(v); const out = {};
    PROFILE_KEYS.forEach((k) => { if (typeof p[k] === 'string') out[k] = p[k]; });
    if (out.mail_client && !MAIL_CLIENTS.includes(out.mail_client)) delete out.mail_client;
    if (Number.isFinite(p.u)) out.u = p.u;
    return out;
  }
  function cleanEntry(v) {
    const e = asObj(v);
    const s = {
      status: Object.hasOwn(STATUS_LABEL, e.status) ? e.status : 'new',
      notes: typeof e.notes === 'string' ? e.notes : '',
      drafts: {},
      contact: e.contact === 'careers' || (Number.isInteger(e.contact) && e.contact >= 0) ? e.contact : 0,
    };
    // Draft keys are the recipient picker's values: a contact index, "careers" or "none".
    Object.entries(asObj(e.drafts)).forEach(([k, d]) => {
      if (!/^(\d{1,3}|careers|none)$/.test(k)) return;
      const out = {}; DRAFT_FIELDS.forEach((f) => { if (typeof asObj(d)[f] === 'string') out[f] = d[f]; });
      if (Object.keys(out).length) s.drafts[k] = out;
    });
    if (typeof e.contacted_at === 'string' && !isNaN(new Date(e.contacted_at))) s.contacted_at = e.contacted_at;
    if (e.contacted_via === 'email' || e.contacted_via === 'linkedin') s.contacted_via = e.contacted_via;
    if (Number.isFinite(e.u)) s.u = e.u; // when it was last edited (Claude page only)
    return s;
  }
  function cleanTracker(v) { const t = plain({}); Object.entries(asObj(v)).forEach(([id, e]) => { t[id] = cleanEntry(e); }); return t; }

  const DEFAULT_PROFILE = Object.assign({
    name: 'Your name', email: 'you@example.com', phone: '', linkedin: '', cv_url: '', headline: '',
    mail_client: 'mailto', signature: '',
  }, window.OH_PROFILE || {});
  // CV links the defaults used to give (see currentLinks). They are not a detail you can edit.
  const RETIRED_CV_URLS = [].concat(DEFAULT_PROFILE.retired_cv_urls || []); delete DEFAULT_PROFILE.retired_cv_urls;
  // mailto: links often do nothing inside the artifact viewer, so default to Gmail there.
  if (HOST && DEFAULT_PROFILE.mail_client === 'mailto') DEFAULT_PROFILE.mail_client = 'gmail';

  // Where progress is kept:
  //   'local'    standalone site: this browser (KEYS.*)
  //   'starting' Claude page, before the account answers: nothing read, nothing editable yet
  //   'account'  Claude page: this browser's copy for this account id, synced with the account
  //   'offline'  Claude page, account known but not reachable or not writable: that same copy only
  //   'memory'   Claude page with no account: kept on this page only, never written anywhere
  // The Claude page never reads the plain KEYS copy: every account that opens the page in this
  // browser shares one origin, so only copies keyed by account id are safe.
  let mode = HOST ? 'starting' : 'local';
  let prefix = ''; // 'oh:u:<account id>:' in 'account' and 'offline'
  const written = Object.create(null); // document name -> JSON in this browser's copy

  let DATA = Array.isArray(window.OH_DATA) ? window.OH_DATA : [];
  let META = window.OH_META || {};
  let tracker = HOST ? plain({}) : cleanTracker(load(KEYS.tracker, {}));
  let savedProfile = HOST ? {} : cleanProfile(load(KEYS.profile, {}));
  let profile = Object.assign({}, DEFAULT_PROFILE, savedProfile);
  function cleanFilters(v) {
    const f = asObj(v); const out = Object.assign({}, DEFAULT_FILTERS);
    Object.keys(DEFAULT_FILTERS).forEach((k) => { if (typeof f[k] === typeof DEFAULT_FILTERS[k] && (typeof f[k] !== 'number' || Number.isFinite(f[k]))) out[k] = f[k]; });
    return out;
  }
  let filters = HOST ? cleanFilters({}) : cleanFilters(load(KEYS.filters, {}));
  // Whether this browser can keep anything at all (private modes and blocked site data can't).
  const storageOk = (() => { try { localStorage.setItem('oh:probe', '1'); localStorage.removeItem('oh:probe'); return true; } catch (e) { return false; } })();

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

  // Three kinds of message: routine results of what the person just did; 'alert', a failure of their
  // own action or a question, which stays up longer but gives way to the result of their next
  // action; and 'notice', news about where progress is saved, which stays up longer and is
  // protected from being replaced for its first 3 s so it can be read.
  function toast(msg, kind = '') {
    const t = $('#toast'); const now = Date.now();
    if (kind !== 'notice' && kind !== 'alert' && now < (toast._until || 0)) return;
    t.classList.add('show'); t.textContent = msg;
    toast._until = kind === 'notice' ? now + 3000 : 0;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.classList.remove('show'); t.textContent = ''; toast._until = 0; }, kind ? 8000 : 2800);
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
  function persist() {
    if (mode === 'local') save(KEYS.tracker, tracker);
    else if (prefix) persistDocs();
    scheduleSync();
  }
  function saveProfile(p) {
    savedProfile = cleanProfile(p); delete savedProfile.u;
    if (mode === 'local') save(KEYS.profile, savedProfile);
    else if (prefix) {
      if (Object.keys(savedProfile).length) { savedProfile.u = Date.now(); written.profile = JSON.stringify(savedProfile); lsSet(docKey('profile'), written.profile); }
      else { delete written.profile; lsDel(docKey('profile')); }
    }
    scheduleSync();
  }

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
    return currentLinks(String(tpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (Object.hasOwn(map, k) ? map[k] : m)));
  }
  // Details saved, and messages edited, before the default CV link changed can still hold a retired
  // link, so it is shown, copied and sent as the current default link instead. What is stored stays as it was.
  function currentLinks(text) {
    const cv = DEFAULT_PROFILE.cv_url; let t = String(text ?? '');
    if (isHttp(cv)) RETIRED_CV_URLS.forEach((u) => { if (typeof u === 'string' && isHttp(u) && !cv.includes(u)) t = t.split(u).join(cv); });
    return t;
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

  // The send and LinkedIn actions are real links (the artifact viewer only opens real links),
  // so their href is kept up to date as the message and recipient change.
  function linkTo(a, url) {
    a.href = url;
    if (isHttp(url)) { a.target = '_blank'; a.rel = 'noopener'; } else { a.removeAttribute('target'); a.removeAttribute('rel'); }
  }

  // ---------- theme ----------
  function effectiveTheme() { return document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); }
  function applyTheme(t) {
    if (t) document.documentElement.setAttribute('data-theme', t);
    const b = $('#btn-theme'); if (b) { const eff = effectiveTheme(); b.setAttribute('aria-label', eff === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'); b.setAttribute('aria-pressed', String(eff === 'dark')); }
  }
  // With no saved choice, leave data-theme alone so the system (or the artifact viewer) decides.
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
    const starting = mode === 'starting';
    $('#stages').innerHTML = STAGES.map(([k, label]) => `<button type="button" class="stage${counts[k] && !starting ? '' : ' is-zero'}" data-stage="${k}" aria-pressed="${filters.status === k}"><span class="n">${starting ? '–' : counts[k]}</span><span class="k">${esc(label)}</span></button>`).join('');
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
  // On the Claude page filters are kept per account, without the search text (it can name people).
  let bootFilters = null; // filters as the Claude page started, before the account answered
  const saveFilters = () => {
    if (!HOST) { save(KEYS.filters, filters); return; }
    if (prefix && mode !== 'starting') save(`${prefix}f`, Object.assign({}, filters, { q: '' }));
  };
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
    // Roles appear once saved progress has loaded, so nothing is edited from a blank copy.
    if (mode === 'starting') { list.innerHTML = '<div class="empty" role="status">Loading your saved progress…</div>'; return; }
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
      syncSendLink();
      const li = c && isHttp(c.linkedin_url) ? c.linkedin_url : peopleSearchUrl(o);
      $$('.act-linkedin', el).forEach((a) => linkTo(a, li));
    }
    function syncSendLink() { linkTo($('.act-send', el), mailLink(recipient().email, subj.value, body.value)); }
    function loadDrafts() {
      const c = current(); const k = key(); let anyEdited = false;
      Object.entries(fields).forEach(([f, input]) => { const d = draft(o, k, f); input.value = d.edited ? currentLinks(d.text) : fill(d.text, o, c); anyEdited = anyEdited || d.edited; });
      notes.value = s.notes || '';
      $$('.act-reset', el).forEach((b) => { b.hidden = !anyEdited; });
      countNote(el); refresh();
    }

    pick.onchange = () => { s.contact = pick.value === 'careers' ? 'careers' : (pick.value === 'none' ? 0 : Number(pick.value)); persist(); loadDrafts(); };

    // Editing stores the edited text for this role + this person only.
    Object.entries(fields).forEach(([f, input]) => { input.oninput = () => { const k = key(); s.drafts[k] = s.drafts[k] || {}; s.drafts[k][f] = input.value; persist(); $$('.act-reset', el).forEach((b) => { b.hidden = false; }); if (input === subj || input === body) syncSendLink(); }; });
    notes.oninput = () => { s.notes = notes.value; persist(); };

    $$('.act-reset', el).forEach((b) => { b.onclick = () => { const f = b.dataset.field; const k = key(); const d = s.drafts[k] || {}; if (f === 'email') { delete d.email_subject; delete d.email_body; } else if (f === 'note') delete d.linkedin_note; else delete d.linkedin_inmail; if (!Object.keys(d).length) delete s.drafts[k]; persist(); loadDrafts(); toast('Back to the original message'); }; });

    const markContacted = (via) => { if (s.status === 'new' || s.status === 'shortlisted') { s.status = 'contacted'; el.dataset.status = 'contacted'; $('.status', el).value = 'contacted'; } if (!s.contacted_at) s.contacted_at = nowIso(); if (!s.contacted_via) s.contacted_via = via; persist(); renderSummary(); renderContactedLine(o, el); };

    // The link itself opens the email; the click only records progress.
    $('.act-send', el).onclick = () => {
      const r = recipient();
      markContacted('email');
      if (HOST && !isHttp(mailLink('', '', ''))) toast('Marked as contacted. If no email opened, use Copy, or choose Gmail or Outlook in Your details.');
      else toast(r.email ? `Opening your email to ${r.email}. Marked as contacted.` : 'Opening your email. Add the address before sending.');
    };
    $('.act-copy-email', el).onclick = async () => { const ok = await copyText(`Subject: ${subj.value}\n\n${body.value}`); if (ok) toast('Email copied'); else toast('Copy failed. Select the text and copy it yourself.', 'alert'); };
    // The link opens LinkedIn; the click copies the message (inside the click, so the clipboard allows it).
    $$('.act-linkedin', el).forEach((b) => { b.onclick = () => {
      const c = current(); const text = b.dataset.kind === 'note' ? note.value : inmail.value;
      const hasProfile = c && isHttp(c.linkedin_url);
      const copied = copyText(text);
      markContacted('linkedin');
      copied.then((ok) => { if (ok) toast(hasProfile ? `Copied. Paste it on ${firstName(c.name)}'s LinkedIn profile.` : 'Copied. No profile link, so LinkedIn search opened.'); else toast('Copy failed, but LinkedIn opened. Copy the message yourself.', 'alert'); });
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
  function fillForm() { Object.entries(profile).forEach(([k, v]) => { const f = form.elements[k]; if (f) f.value = currentLinks(v); }); }
  function openDrawer() { fillForm(); delete form.dataset.dirty; lastFocus = document.activeElement; drawer.hidden = false; document.body.classList.add('drawer-open'); backdrop.hidden = false; inertTargets().forEach((n) => { n.inert = true; }); $('input[name="name"]', form).focus(); }
  function closeDrawer() { drawer.hidden = true; backdrop.hidden = true; document.body.classList.remove('drawer-open'); if (closeDrawer.redraw) { closeDrawer.redraw = false; keepUI(renderList); } inertTargets().forEach((n) => { n.inert = false; }); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
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
  form.addEventListener('submit', (e) => { e.preventDefault(); const fd = new FormData(form); profile = Object.assign({}, DEFAULT_PROFILE, Object.fromEntries(fd.entries())); saveProfile(profile); closeDrawer(); renderList(); toast('Saved. Messages you haven\'t edited now use these details.'); });
  $('#btn-profile-reset').addEventListener('click', () => { profile = Object.assign({}, DEFAULT_PROFILE); saveProfile({}); fillForm(); renderList(); toast('Back to the default details'); });

  // The backup holds only the details you saved, so restoring it elsewhere keeps that page's defaults.
  $('#btn-backup').addEventListener('click', async () => toastSaved(await download('opportunity-hunter-backup.json', JSON.stringify({ tracker, profile: savedProfile, source: HOST ? 'claude-page' : 'site', exported_at: nowIso() }, null, 2), 'application/json'), 'Backup saved'));
  $('#file-restore').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    e.target.value = '';
    let t = null, p = null, source = '';
    try {
      const j = asObj(JSON.parse(await f.text()));
      if (j.tracker && typeof j.tracker === 'object' && !Array.isArray(j.tracker)) t = cleanTracker(j.tracker);
      if (j.profile && typeof j.profile === 'object' && !Array.isArray(j.profile)) p = cleanProfile(j.profile);
      source = j.source;
    } catch (err) { /* not JSON */ }
    // A backup from the plain site carries its mailto: default, which rarely opens from the Claude page.
    if (p && HOST && source !== 'claude-page' && p.mail_client === 'mailto') delete p.mail_client;
    if (p) delete p.u;
    if (p && !Object.keys(p).length) p = null; // nothing usable: keep the details you have
    if (!t && !p) { toast('That file could not be read', 'alert'); return; }
    if (t) { tracker = t; persist(); }
    if (p) { profile = Object.assign({}, DEFAULT_PROFILE, p); saveProfile(p); }
    fillForm(); renderSummary(); renderList(); toast('Backup restored');
  });
  // Standalone this is a confirm() dialog. The artifact viewer blocks confirm(), so there it takes a
  // second, separate click: a double-click or a held key never counts as the confirmation. The
  // button keeps its label (so it doesn't move under a finger) and the toast says what will go.
  const wipe = $('#btn-wipe'); const wipeLabel = wipe.textContent;
  wipe.addEventListener('keydown', (e) => { if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault(); }); // a held key clicks only once
  const disarmWipe = () => { clearTimeout(wipe._t); delete wipe.dataset.armed; wipe.textContent = wipeLabel; wipe.removeAttribute('aria-describedby'); const t = $('#toast'); if (/^Click Clear everything again/.test(t.textContent)) { t.classList.remove('show'); t.textContent = ''; } };
  const clearAll = () => { tracker = plain({}); persist(); renderSummary(); renderList(); toast('Cleared'); };
  wipe.addEventListener('click', (e) => {
    if (!HOST) { if (confirm('Clear all progress, notes and edited messages in this browser?')) clearAll(); return; }
    const now = performance.now(); const gap = now - (wipe._last || -Infinity); wipe._last = now;
    if (wipe.dataset.armed !== '1') {
      wipe.dataset.armed = '1'; wipe._armedAt = now;
      wipe.setAttribute('aria-describedby', 'toast');
      toast(`Click Clear everything again to delete all progress, notes and edited messages${sync.col ? ', here and in your Claude account' : ''}. Your details are kept.`, 'alert');
      clearTimeout(wipe._t); wipe._t = setTimeout(disarmWipe, 8000); return;
    }
    if (e.detail > 1 || gap < 400 || now - wipe._armedAt < 600) return;
    disarmWipe(); clearAll();
  });

  // ---------- export ----------
  function csvCell(v) { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
  // In the artifact viewer a page can't start a download itself, so files go through its save prompt.
  // Resolves true when saved, false when not, and null when a plain download was started but the
  // page can't tell whether it worked (a Claude page without the save prompt).
  const downloads = HOST ? HOST.use('downloads').catch(() => null) : null;
  async function download(name, text, type) {
    // A host that never answers resolves null only after 10 s: don't keep the click waiting that long.
    const dl = HOST ? await Promise.race([downloads, new Promise((r) => { setTimeout(() => r(null), 1500); })]) : null;
    if (dl) {
      try { await dl.save({ filename: name, data: text }); return true; }
      catch (e) { if (!e || e.code !== 'declined') toast(e && e.code === 'rate_limited' ? 'A save is already waiting for you. Answer it first.' : 'The file could not be saved.', 'alert'); return false; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return HOST ? null : true;
  }
  function toastSaved(result, msg) {
    if (result) toast(msg);
    else if (result === null) toast('Download started. If no file appears, this page can\'t save files.', 'alert');
  }
  const exportCsv = async () => {
    const head = ['company', 'role', 'location', 'region', 'remote', 'score', 'status', 'first_contact', 'job_url', 'contact_name', 'contact_title', 'contact_role', 'contact_verified', 'linkedin_url', 'email', 'email_status', 'careers_email', 'email_pattern', 'rationale', 'outreach_angle', 'notes'];
    const rows = [head.join(',')];
    visible().forEach((o) => {
      const s = state(o.id); const cs = (o.contacts && o.contacts.length) ? o.contacts : [{}];
      cs.forEach((c) => rows.push([o.company, o.role_title, o.location, o.region, o.remote_policy, o.score, s.status, s.contacted_at || '', o.job_url, c.name, c.title, c.role_type, c.verified === true ? 'yes' : 'no', c.linkedin_url, c.email, c.email_status, o.careers_email, o.email_pattern, o.rationale, o.outreach_angle, s.notes].map(csvCell).join(',')));
    });
    toastSaved(await download('opportunity-hunter.csv', rows.join('\n'), 'text/csv'), `Saved ${rows.length - 1} rows as CSV`);
  };
  $('#btn-export').addEventListener('click', exportCsv);
  $('#btn-export-2').addEventListener('click', exportCsv);

  // ---------- saved to your Claude account (only inside the artifact viewer) ----------
  // The account copy lives under data/users/<account id>/ in the artifact's db, which nobody else can
  // read: one document per role ("t-<role id>") plus "profile". This browser keeps, per account id
  // and per document, its own copy ("<prefix>t:<role id>", "<prefix>p") and what the account was last
  // known to hold ("<prefix>s:<document>"). Each document records when it was last edited ("u").
  // When the page opens, every document is merged three ways:
  //   - this browser's copy is unchanged since it last matched the account: the account wins,
  //     including when the account no longer has it (cleared or reset on another device);
  //   - only this browser changed it (say the tab closed before the upload): this browser wins
  //     and is uploaded;
  //   - both changed: the later edit wins.
  // The roles stay hidden until this has run, so nothing is ever edited from a blank copy.
  const SEG = /^[A-Za-z0-9_\-.~:@+]{1,180}$/;
  const STOP_CODES = ['revoked', 'not_granted', 'capability_disabled', 'capability_removed'];
  const BLOCK_CODES = ['invalid_argument', 'transform_error', 'quota_exceeded'];
  const sync = { col: null, last: Object.create(null), blocked: Object.create(null), timer: 0, running: false, again: false, attempt: 0, failCode: '', canWrite: null };
  const inBrowser = storageOk ? ' Progress is still saved in this browser.' : '';
  // Rendering a card creates a blank entry for it; only roles the person has touched are saved.
  function untouched(s) { return !s || ((s.status || 'new') === 'new' && !s.notes && !s.contacted_at && !s.contact && !(s.drafts && Object.keys(s.drafts).length)); }
  function lsKeys(pre) { const out = []; try { for (let i = 0; i < localStorage.length; i += 1) { const k = localStorage.key(i); if (k && k.startsWith(pre)) out.push(k); } } catch (e) { /* storage blocked */ } return out; }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* full or blocked */ } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* blocked */ } }
  const isDocName = (n) => n === 'profile' || (typeof n === 'string' && n.startsWith('t-') && SEG.test(n.slice(2)));
  function docKey(name) { return name === 'profile' ? `${prefix}p` : `${prefix}t:${name.slice(2)}`; }
  // Canonical JSON of a role entry or of the profile, or null when there is nothing to keep.
  function entryJson(v) { const e = cleanEntry(v); return untouched(e) ? null : JSON.stringify(e); }
  function profileJson(v) { const p = cleanProfile(v); const content = Object.assign({}, p); delete content.u; return Object.keys(content).length ? JSON.stringify(p) : null; }
  function docJson(name, v) { return name === 'profile' ? profileJson(v) : entryJson(v); }
  function parseDoc(name, json) { try { return docJson(name, JSON.parse(json)); } catch (e) { return null; } }
  // Two copies match when they differ at most in their edit time.
  function content(json) { if (!json) return null; try { const o = JSON.parse(json); delete o.u; return JSON.stringify(o); } catch (e) { return null; } }
  function sameContent(a, b) { return content(a) === content(b); }
  // Left in place of "what the account held" after a delete. It reads as no document, but it is a
  // change another loading tab can see.
  const removedMark = () => JSON.stringify({ removed: Date.now() });
  function editedAt(json) { try { const u = JSON.parse(json).u; return Number.isFinite(u) ? u : 0; } catch (e) { return 0; } }

  // Writes the roles this tab changed into this browser's copy, with their edit time. Only changed
  // documents are written, so a second tab on the same account never overwrites the others.
  function persistDocs() {
    const now = Date.now();
    const names = new Set(Object.keys(written).filter((n) => n !== 'profile'));
    Object.keys(tracker).forEach((id) => { if (SEG.test(id)) names.add(`t-${id}`); });
    names.forEach((name) => {
      const e = tracker[name.slice(2)];
      if (sameContent(entryJson(e), written[name] || null)) return;
      if (untouched(e)) { delete written[name]; lsDel(docKey(name)); return; }
      e.u = now; written[name] = entryJson(e); lsSet(docKey(name), written[name]);
    });
  }
  function wantDocs() {
    const m = Object.create(null);
    Object.keys(tracker).forEach((id) => { if (SEG.test(id)) { const j = entryJson(tracker[id]); if (j) m[`t-${id}`] = j; } });
    const p = profileJson(savedProfile); if (p) m.profile = p;
    return m;
  }

  function scheduleSync(delay = 800) { if (!sync.col) return; clearTimeout(sync.timer); sync.timer = setTimeout(flushSync, delay); }
  function reportSync(code) {
    if (!code) {
      if (Object.keys(sync.blocked).length) return;
      if (sync.failCode && !BLOCK_CODES.includes(sync.failCode)) { const t = $('#toast'); if (/^Couldn't save to your Claude account just now/.test(t.textContent)) { t.classList.remove('show'); t.textContent = ''; toast._until = 0; } }
      sync.failCode = ''; return;
    }
    if (code === sync.failCode) return; // already told
    sync.failCode = code;
    toast(code === 'quota_exceeded' ? `Your Claude account storage for this page is full.${inBrowser}`
      : BLOCK_CODES.includes(code) ? `One role couldn't be saved to your Claude account.${storageOk ? ' It\'s still saved in this browser.' : ''}`
        : `Couldn't save to your Claude account just now. Trying again.${inBrowser}`, 'notice');
  }
  function stopSync(kind) {
    sync.col = null; clearTimeout(sync.timer);
    setSavedWhere(storageOk ? 'in this browser only' : 'only until you close this page');
    toast(kind === 'nowrite' ? `This page isn't allowed to save to your Claude account.${inBrowser}` : `This page can no longer save to your Claude account.${inBrowser}`, 'notice');
  }
  async function flushSync() {
    if (!sync.col) return;
    if (sync.running) { sync.again = true; return; }
    sync.running = true; let retry = false, problem = '';
    try {
      const want = wantDocs();
      // A document refused as it was is tried again once it has changed.
      Object.keys(sync.blocked).forEach((n) => { if (!sameContent(sync.blocked[n].json, want[n] || null)) delete sync.blocked[n]; });
      // One write at a time, only where the account differs. A failure affects only its own document.
      for (const name of new Set([...Object.keys(want), ...Object.keys(sync.last)])) {
        if (!sync.col) break;
        const json = want[name] || null;
        if (sameContent(json, sync.last[name] || null) || Object.hasOwn(sync.blocked, name)) continue;
        try {
          const ref = sync.col.doc(name);
          if (json) { await ref.set(JSON.parse(json)); sync.last[name] = json; lsSet(`${prefix}s:${name}`, json); }
          else {
            await ref.delete(); delete sync.last[name]; lsSet(`${prefix}s:${name}`, removedMark());
            // Space was freed, so documents refused for a full store can go again.
            Object.keys(sync.blocked).forEach((n) => { if (sync.blocked[n].code === 'quota_exceeded') { delete sync.blocked[n]; sync.again = true; } });
          }
        } catch (e) {
          const code = (e && e.code) || 'unavailable';
          if (STOP_CODES.includes(code)) { stopSync('stopped'); break; }
          // Refusing a small, ordinary document means this viewer may not write here at all
          // (unless the host has said it may).
          if (code === 'invalid_argument' && sync.canWrite !== true && (!json || new TextEncoder().encode(json).length < 200000)) { stopSync('nowrite'); break; }
          if (BLOCK_CODES.includes(code)) sync.blocked[name] = { json, code }; else retry = true;
          problem = problem || code;
        }
      }
    } finally {
      sync.running = false;
      if (sync.col) reportSync(problem);
      if (sync.again) { sync.again = false; scheduleSync(); }
      else if (retry) { sync.attempt += 1; scheduleSync(Math.min(60000, 1000 * 2 ** sync.attempt) + Math.floor(Math.random() * 500)); }
      else sync.attempt = 0;
    }
  }
  // Send what's waiting when the page is hidden or closed. Anything that doesn't make it is in this
  // browser's copy and goes out the next time the page opens.
  const flushNow = () => { if (sync.col) { clearTimeout(sync.timer); flushSync(); } };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushNow(); });
  window.addEventListener('pagehide', flushNow);

  function setSavedWhere(text) { $$('.saved-where').forEach((n) => { n.textContent = text; }); }
  // Redraws caused by another tab keep each card's open panels and tab, the focused control and its
  // text selection, and the scroll position.
  const controls = (el) => $$('a[href], button, input, select, textarea', el);
  function keepUI(redraw) {
    const state = new Map(); const active = document.activeElement; let focus = null;
    $$('#list .card').forEach((c) => {
      state.set(c.dataset.id, { details: !$('.details', c).hidden, composer: !$('.composer', c).hidden, tab: ($('.tab.active', c) || {}).dataset?.tab });
      if (c.contains(active)) focus = { id: c.dataset.id, at: controls(c).indexOf(active), range: typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null };
    });
    const y = window.scrollY;
    redraw();
    $$('#list .card').forEach((c) => {
      const st = state.get(c.dataset.id); if (!st) return;
      [['.details', '.btn-details', st.details], ['.composer', '.btn-write', st.composer]].forEach(([panel, btn, open]) => {
        if (open) { $(panel, c).hidden = false; $(btn, c).setAttribute('aria-expanded', 'true'); c.classList.add('is-open'); }
      });
      if (st.tab) { const t = $$('.tab', c).find((x) => x.dataset.tab === st.tab); if (t && !t.classList.contains('active')) t.click(); }
    });
    window.scrollTo(window.scrollX, y);
    if (focus && focus.at >= 0) {
      const c = $$('#list .card').find((x) => x.dataset.id === focus.id); const target = c ? controls(c)[focus.at] : null;
      if (target) { target.focus({ preventScroll: true }); if (focus.range && typeof target.setSelectionRange === 'function') { try { target.setSelectionRange(focus.range[0], focus.range[1]); } catch (e) { /* not a text field */ } } }
    }
  }
  function redrawCard(id) {
    if (filters.status !== 'any' || filters.sort === 'recent') { keepUI(renderList); return; }
    const old = $$('#list .card').find((c) => c.dataset.id === id); const o = DATA.find((x) => x.id === id);
    if (!old || !o) return;
    keepUI(() => { old.replaceWith(renderCard(o, $('#tpl-card'))); });
  }
  form.addEventListener('input', () => { form.dataset.dirty = '1'; });
  // Another tab on the same account changed this browser's copy: show its change here too.
  window.addEventListener('storage', (ev) => {
    if (!prefix || mode === 'starting' || !ev.key || !ev.key.startsWith(prefix)) return;
    const rest = ev.key.slice(prefix.length);
    if (rest.startsWith('s:')) {
      const n = rest.slice(2); if (!isDocName(n)) return;
      const j = ev.newValue ? parseDoc(n, ev.newValue) : null;
      if (j) sync.last[n] = j; else delete sync.last[n];
      return;
    }
    const name = rest === 'p' ? 'profile' : (rest.startsWith('t:') ? `t-${rest.slice(2)}` : '');
    if (!isDocName(name)) return;
    const json = ev.newValue ? parseDoc(name, ev.newValue) : null;
    if (json) written[name] = json; else delete written[name];
    if (name === 'profile') {
      savedProfile = json ? JSON.parse(json) : {}; profile = Object.assign({}, DEFAULT_PROFILE, savedProfile);
      if (drawer.hidden) keepUI(renderList);
      else { if (form.dataset.dirty !== '1') fillForm(); closeDrawer.redraw = true; }
      return;
    }
    const id = name.slice(2); const next = json ? JSON.parse(json) : cleanEntry({});
    const cur = tracker[id];
    if (cur && typeof cur === 'object') { Object.keys(cur).forEach((k) => { delete cur[k]; }); Object.assign(cur, next); } else tracker[id] = next;
    renderSummary(); redrawCard(id);
  });

  const GATED = ['#btn-profile', '#btn-export', '#btn-export-2'];
  function finishStart(next, where) {
    mode = next;
    setSavedWhere(where);
    GATED.forEach((sel) => { const b = $(sel); if (b) b.disabled = false; });
    renderSummary(); renderList();
  }
  const pause = (ms) => new Promise((r) => { setTimeout(r, ms); });
  const NOT_KEPT = 'only until you close this page';

  // A call that never settles must not leave the page on "Loading" for good.
  const FAILED = Symbol('failed');
  const settle = (p, ms) => Promise.race([Promise.resolve(p).catch(() => FAILED), pause(ms).then(() => FAILED)]);
  function readCopy(kind) {
    const out = Object.create(null), raw = Object.create(null);
    lsKeys(prefix).forEach((k) => {
      const rest = k.slice(prefix.length); const v = lsGet(k); if (v == null) return;
      let n = '';
      if (kind === 's' && rest.startsWith('s:')) n = rest.slice(2);
      else if (kind === 'local' && rest === 'p') n = 'profile';
      else if (kind === 'local' && rest.startsWith('t:')) n = `t-${rest.slice(2)}`;
      if (!isDocName(n)) return;
      raw[n] = v; const j = parseDoc(n, v); if (j) out[n] = j;
    });
    return { docs: out, raw };
  }

  async function connectAccount() {
    if (!HOST) return;
    let db = null, user = null, uid = null;
    try { [db, user] = await Promise.all([HOST.use('db'), HOST.use('user')]); } catch (e) { /* neither */ }
    if (user) { const id = await settle(user.id(), 6000); uid = id === FAILED ? null : id; }
    if (!uid || !SEG.test(String(uid)) || (!storageOk && !db)) {
      finishStart('memory', NOT_KEPT);
      toast('This page can\'t reach your Claude account, so changes made now won\'t be kept after you close it.', 'notice');
      return;
    }
    // The id is encoded so one account's keys can never look like another's (ids may contain ':').
    prefix = `oh:u:${encodeURIComponent(uid)}:`;
    if (typeof user.can === 'function') { const c = await settle(user.can('data.write'), 6000); sync.canWrite = c === true ? true : (c === false ? false : null); }

    // What this browser knew the account held is read before asking the account. It is written
    // only after the account accepted a write, so it can't be newer than the answer that follows.
    let synced = readCopy('s');
    const col = db ? db.collection(`data/users/${uid}`) : null;
    let snap = null;
    for (let i = 0; col && i < 3 && !snap; i += 1) {
      synced = readCopy('s');
      const r = await settle(col.get(), 10000);
      if (r !== FAILED) { snap = r; break; }
      if (i < 2) await pause(800 * (i + 1) + Math.floor(Math.random() * 400));
    }

    // From here to the end there is no await. This browser's copy is read now, after the account
    // has answered, so changes another tab made while this one was loading are part of the merge.
    const { docs: local } = readCopy('local');
    const hasCopy = Object.keys(local).length > 0 || Object.keys(synced.docs).length > 0;
    if (!snap && !hasCopy) {
      // Nothing to go on: never treat a silent account as an empty one.
      prefix = '';
      finishStart('memory', NOT_KEPT);
      toast('Couldn\'t load your saved progress from your Claude account. Reload the page to try again; changes made now won\'t be kept.', 'notice');
      return;
    }
    // An earlier version of this page kept progress without the account id, and uploaded it to
    // its owner's account as it went. It can't tell whose it is, so it is removed, not imported.
    [KEYS.tracker, KEYS.profile, KEYS.filters].forEach(lsDel);

    const account = Object.create(null);
    const names = new Set([...Object.keys(local), ...Object.keys(synced.docs)]);
    let merged = local;
    if (snap) {
      snap.docs.forEach((d) => {
        const body = d.exists ? d.data() : null; if (!body || !isDocName(d.id)) return;
        const j = docJson(d.id, body); if (j) { account[d.id] = j; names.add(d.id); }
      });
      merged = Object.create(null);
      names.forEach((n) => {
        const L = local[n] || null, C = synced.docs[n] || null, A = account[n] || null;
        // Another tab synced this document while this one was loading: its copy here is newer
        // than the answer this tab got.
        const moved = (lsGet(`${prefix}s:${n}`) ?? null) !== (synced.raw[n] ?? null);
        let v;
        if (moved) v = L;
        else if (L === C) v = A; // nothing new here (not even an edit and undo): the account is the record
        else if (sameContent(A, C)) v = L; // only this browser changed it
        else if (!L || !A) v = L || A; // one side removed it, the other changed it: keep the change
        else v = editedAt(L) > editedAt(A) ? L : A; // both changed: the later edit wins
        if (v) merged[n] = v;
      });
    }

    tracker = plain({}); savedProfile = {};
    Object.entries(merged).forEach(([n, j]) => { if (n === 'profile') savedProfile = JSON.parse(j); else tracker[n.slice(2)] = JSON.parse(j); });
    profile = Object.assign({}, DEFAULT_PROFILE, savedProfile);
    // This browser's copy now matches the page; only documents that differ are rewritten.
    Object.keys(written).forEach((n) => { delete written[n]; });
    names.forEach((n) => {
      if (merged[n]) { written[n] = merged[n]; if (local[n] !== merged[n]) lsSet(docKey(n), merged[n]); } else if (local[n]) lsDel(docKey(n));
    });
    if (snap) {
      // What the account holds, as far as this tab knows. Where another tab recorded an accepted
      // write after this tab asked the account, that record is newer than the answer: keep it.
      sync.last = Object.create(null);
      const sNames = new Set([...names, ...Object.keys(synced.raw)]);
      sNames.forEach((n) => {
        const key = `${prefix}s:${n}`; const now = lsGet(key);
        if (now !== (synced.raw[n] ?? null)) { const j = now ? parseDoc(n, now) : null; if (j) sync.last[n] = j; return; }
        if (account[n]) { sync.last[n] = account[n]; if (now !== account[n]) lsSet(key, account[n]); } else if (now != null && parseDoc(n, now)) lsSet(key, removedMark());
      });
    } else sync.last = synced.docs;

    // Saved filters come back, except the ones changed while the page was loading.
    const f = load(`${prefix}f`, null);
    const changedEarly = Object.keys(DEFAULT_FILTERS).filter((k) => k !== 'q' && bootFilters && filters[k] !== bootFilters[k]);
    if (f && typeof f === 'object') {
      const saved = cleanFilters(f);
      Object.keys(DEFAULT_FILTERS).forEach((k) => { if (k !== 'q' && !changedEarly.includes(k)) filters[k] = saved[k]; });
      setFilterInputs();
      if (activeExtraFilters()) { $('#more-filters').hidden = false; $('#btn-more').setAttribute('aria-expanded', 'true'); }
    }

    if (snap && sync.canWrite !== false) {
      sync.col = col;
      finishStart('account', storageOk ? 'to your Claude account and this browser' : 'to your Claude account');
      scheduleSync(0);
    } else if (snap || sync.canWrite === false) {
      finishStart('offline', 'in this browser only');
    } else {
      finishStart('offline', 'in this browser for now (reload the page to update your Claude account)');
      toast('Couldn\'t reach your Claude account. Your progress is kept in this browser; reload the page to try again.', 'notice');
    }
    if (changedEarly.length) saveFilters(); // the filters chosen while loading, with the saved ones
  }

  // ---------- boot ----------
  async function boot() {
    if (HOST) { GATED.forEach((sel) => { const b = $(sel); if (b) b.disabled = true; }); setSavedWhere('to your Claude account, once it has loaded'); }
    if (!DATA.length && location.protocol !== 'file:') {
      try { const r = await fetch('data/opportunities.json', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); DATA = Array.isArray(j.opportunities) ? j.opportunities : []; META = j.meta || {}; } } catch (e) { /* no data */ }
    }
    DATA = DATA.filter((o) => o && typeof o === 'object' && o.company);
    DATA.forEach((o) => { if (!o.id) o.id = slug(`${o.company} ${o.role_title || ''}`); });
    bootFilters = Object.assign({}, filters);
    bindFilters(); renderSummary(); renderList();
    connectAccount();
  }
  boot();
})();
