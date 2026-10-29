/* Life Costs — personal spending app (built from Life Costs)
   Spends with the account paid from, categories, receipt photos, passcode lock,
   offline queue + sync, regular payments (spends added automatically on a schedule).
   Dashboard (stage 3) and reminders (stage 4) are in the code but switched off below. */
(() => {
'use strict';

const VERSION = '1.0.0';
// Parts of the app still to be signed off are switched off here.
const FEATURES = { dash: false, rem: false };
const API = location.origin; // the app and its server share one address
const LOCK_AFTER_MS = 5 * 60 * 1000;     // lock again after 5 minutes in the background
const POLL_MS = 30 * 1000;               // check for another device's changes every 30 s
const PBKDF2_ROUNDS = 150000;

const $app = document.getElementById('app');
const $ov = document.getElementById('overlay');

// ---------------------------------------------------------------- icons
const svg = (p, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${p}</svg>`;
const I = {
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  filter: svg('<path d="M3 5h18M6 12h12M10 19h4"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 'stroke-width="2.4"'),
  camera: svg('<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13.5" r="3.5"/>'),
  clip: svg('<path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  doc: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>'),
  bell: svg('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>'),
  repeat: svg('<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>', 'stroke-width="2.6"'),
};

// ---------------------------------------------------------------- small utils
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
const money = (p) => gbp.format((p || 0) / 100);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
const pad2 = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const today = () => isoDate(new Date());
const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDate = (s) => parseISO(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fmtMonth = (ym) => parseISO(ym + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const fmtStamp = (ms) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtTime = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
function parseMoney(v) {
  const s = String(v || '').replace(/[£,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(s) && !/^\.\d{1,2}$/.test(s)) return null;
  return Math.round(parseFloat(s) * 100);
}
const penceToInput = (p) => (p / 100).toFixed(2);
const te = new TextEncoder();
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function toast(msg, ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// ---------------------------------------------------------------- IndexedDB
const idb = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('life-costs', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('blobs'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (store, mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  };
  return {
    get: (s, k) => tx(s, 'readonly', (o) => o.get(k)),
    set: (s, k, v) => tx(s, 'readwrite', (o) => o.put(v, k)),
    del: (s, k) => tx(s, 'readwrite', (o) => o.delete(k)),
    clear: (s) => tx(s, 'readwrite', (o) => o.clear()),
  };
})();

// ---------------------------------------------------------------- state
const S = {
  auth: null,          // { user, token, salt, hash, len }
  unlocked: false,
  cats: {}, spends: {}, photos: {}, reminders: {}, regulars: {}, seq: 0,
  outbox: [],
  filter: { q: '', cat: '', from: '', to: '', est: false, acct: '' },
  view: 'list',            // 'list', 'rem' or 'dash'
  dashYear: new Date().getFullYear(),
  sync: { busy: false, last: 0, error: '', offline: !navigator.onLine },
  hiddenAt: 0,
};

function readAuth() {
  try { return JSON.parse(localStorage.getItem('lc.auth') || 'null'); } catch { return null; }
}
function writeAuth(a) {
  try { a ? localStorage.setItem('lc.auth', JSON.stringify(a)) : localStorage.removeItem('lc.auth'); } catch {}
}
const pref = {
  get(k, d) { try { const v = localStorage.getItem('lc.' + k); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('lc.' + k, v); } catch {} },
};

let saveTimer = null;
function saveData() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    idb.set('kv', 'data', { cats: S.cats, spends: S.spends, photos: S.photos, reminders: S.reminders, regulars: S.regulars, seq: S.seq }).catch(() => {});
  }, 250);
}
function saveOutbox() {
  return idb.set('kv', 'outbox', S.outbox.map(({ sending, ...o }) => o)).catch(() => {});
}
async function loadLocal() {
  try {
    const d = await idb.get('kv', 'data');
    if (d) Object.assign(S, { cats: d.cats || {}, spends: d.spends || {}, photos: d.photos || {}, reminders: d.reminders || {}, regulars: d.regulars || {}, seq: d.seq || 0 });
    // Phones that synced before reminders existed need one full re-sync to pick them up.
    if (d && (!d.reminders || !d.regulars)) S.seq = 0;
    S.outbox = (await idb.get('kv', 'outbox')) || [];
  } catch (e) { /* private mode etc. — run from memory */ }
}

// ---------------------------------------------------------------- passcode hashing (local unlock)
async function hashCode(code, saltB64) {
  const key = await crypto.subtle.importKey('raw', te.encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64(saltB64), iterations: PBKDF2_ROUNDS, hash: 'SHA-256' }, key, 256);
  return b64(new Uint8Array(bits));
}

// ---------------------------------------------------------------- API
async function api(method, path, body, { raw = false, timeout = 20000 } = {}) {
  if (!API || API.includes('YOUR-')) { const e = new Error('The app is not connected to its server yet (config.js)'); e.status = 0; throw e; }
  const headers = {};
  if (S.auth && S.auth.token) headers.Authorization = 'Bearer ' + S.auth.token;
  let payload;
  if (body instanceof Blob) { payload = body; headers['Content-Type'] = body.type || 'image/jpeg'; }
  else if (body !== undefined) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(API + path, { method, headers, body: payload, signal: ctrl.signal, cache: 'no-store' });
  } catch (e) {
    const err = new Error('No connection'); err.network = true; throw err;
  } finally { clearTimeout(timer); }
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json()).error; } catch {}
    const err = new Error(msg || 'Error ' + res.status); err.status = res.status; throw err;
  }
  return raw ? res : res.json();
}

// ---------------------------------------------------------------- outbox (offline queue)
function pendingIds() { return new Set(S.outbox.map((o) => o.id).concat(S.outbox.map((o) => o.spend).filter(Boolean))); }

function queue(op) {
  const i = S.outbox.findIndex((o) => !o.sending && o.t === op.t && o.id === op.id && (op.t === 'spend' || op.t === 'cat' || op.t === 'rem' || op.t === 'reg'));
  if (i >= 0) S.outbox[i] = op; else S.outbox.push(op);
  saveOutbox();
}

async function sendOp(op) {
  if (op.t === 'spend') {
    const row = await api('PUT', '/spends/' + op.id, op.rec);
    if (!S.outbox.some((o) => o !== op && o.id === op.id)) { S.spends[op.id] = row; saveData(); }
  } else if (op.t === 'del') {
    await api('DELETE', '/spends/' + op.id);
  } else if (op.t === 'cat') {
    const row = await api('PUT', '/categories/' + op.id, op.rec);
    if (!S.outbox.some((o) => o !== op && o.id === op.id)) { S.cats[op.id] = row; saveData(); }
  } else if (op.t === 'photo') {
    const blob = await idb.get('blobs', op.id).catch(() => null);
    if (!blob) return; // photo was removed before it ever uploaded
    await api('PUT', `/photos/${op.id}?spend=${encodeURIComponent(op.spend)}`, blob, { timeout: 60000 });
    if (S.photos[op.id]) { delete S.photos[op.id].pending; saveData(); }
  } else if (op.t === 'delphoto') {
    await api('DELETE', '/photos/' + op.id);
  } else if (op.t === 'rem') {
    const row = await api('PUT', '/reminders/' + op.id, op.rec);
    if (!S.outbox.some((o) => o !== op && o.id === op.id)) { S.reminders[op.id] = row; saveData(); }
  } else if (op.t === 'remdel') {
    await api('DELETE', '/reminders/' + op.id);
  } else if (op.t === 'reg') {
    const row = await api('PUT', '/regulars/' + op.id, op.rec);
    if (!S.outbox.some((o) => o !== op && o.id === op.id)) { const { added, repriced, ...g } = row; S.regulars[op.id] = g; saveData(); }
  } else if (op.t === 'regdel') {
    await api('DELETE', '/regulars/' + op.id);
  }
}

function rejected(op, e) {
  if (op.t === 'spend' && e.status === 409) {
    removeSpendLocally(op.id);
    toast('A spend you edited had been deleted on another device');
  } else if (op.t === 'reg' && e.status === 409) {
    delete S.regulars[op.id]; saveData();
    toast('A regular payment you edited had been deleted on another device');
  } else if (op.t === 'rem' && e.status === 409) {
    delete S.reminders[op.id]; saveData();
    toast('A reminder you edited had been deleted on another device');
  } else {
    toast('Could not save a change: ' + e.message, 4000);
  }
}

async function flush() {
  while (S.outbox.length) {
    const op = S.outbox[0];
    op.sending = true;
    try {
      await sendOp(op);
    } catch (e) {
      op.sending = false;
      if (e.status === 401) { authExpired(); throw e; }
      if (e.network || !e.status || e.status >= 500 || e.status === 429) throw e;
      rejected(op, e);
    }
    const i = S.outbox.indexOf(op);
    if (i >= 0) S.outbox.splice(i, 1);
    await saveOutbox();
  }
}

async function pull() {
  const d = await api('GET', '/sync?since=' + S.seq);
  const pend = pendingIds();
  d.categories.forEach((c) => { if (!pend.has(c.id)) S.cats[c.id] = c; });
  d.spends.forEach((s) => {
    if (s.deleted) removeSpendLocally(s.id, true);
    else if (!pend.has(s.id)) S.spends[s.id] = s;
  });
  d.photos.forEach((p) => {
    if (p.deleted) { delete S.photos[p.id]; idb.del('blobs', p.id).catch(() => {}); }
    else S.photos[p.id] = Object.assign({}, S.photos[p.id], p, { pending: undefined });
  });
  (d.regulars || []).forEach((g) => {
    if (g.deleted) { delete S.regulars[g.id]; S.outbox = S.outbox.filter((o) => o.id !== g.id || o.sending); }
    else if (!pend.has(g.id)) S.regulars[g.id] = g;
  });
  (d.reminders || []).forEach((r) => {
    if (r.deleted) { delete S.reminders[r.id]; S.outbox = S.outbox.filter((o) => o.id !== r.id || o.sending); }
    else if (!pend.has(r.id)) S.reminders[r.id] = r;
  });
  S.seq = d.seq;
  saveData();
}

function removeSpendLocally(id, fromServer) {
  delete S.spends[id];
  Object.values(S.photos).forEach((p) => {
    if (p.spend_id === id) { delete S.photos[p.id]; idb.del('blobs', p.id).catch(() => {}); }
  });
  if (fromServer) S.outbox = S.outbox.filter((o) => !(o.id === id || o.spend === id) || o.sending);
  saveData();
}

let syncing = null, syncAgain = false;
function sync() {
  if (!S.auth || !S.auth.token) return Promise.resolve();
  if (syncing) { syncAgain = true; return syncing; }
  S.sync.busy = true; renderStatus();
  syncing = (async () => {
    try {
      do { syncAgain = false; await flush(); await pull(); } while (syncAgain);
      S.sync.last = Date.now(); S.sync.error = ''; S.sync.offline = false;
    } catch (e) {
      S.sync.offline = !!e.network;
      S.sync.error = e.network ? '' : e.message;
    } finally {
      S.sync.busy = false; syncing = null;
      renderStatus(); renderList(); refreshRegGroup();
    }
  })();
  return syncing;
}

function authExpired() {
  if (!S.auth) return;
  S.auth = Object.assign({}, S.auth, { token: null });
  writeAuth(S.auth);
  showLock('signin', 'Please sign in again with your passcode.');
}

// ---------------------------------------------------------------- lock / sign-in screen
let lockEl = null;
function showLock(mode, note) {
  S.unlocked = false;
  if (lockEl) lockEl.remove();
  lockEl = document.createElement('div');
  lockEl.className = 'lock';
  document.body.appendChild(lockEl);
  let code = '', busy = false, fails = 0, waitUntil = 0;
  const signin = mode === 'signin';
  const maxLen = signin ? 12 : S.auth.len;

  const draw = (msg = '', shake = false) => {
    const waiting = Date.now() < waitUntil;
    lockEl.innerHTML = `
      <img class="lock-logo" src="icon-192.png" alt="">
      <h2>${signin ? 'Life Costs' : 'Hello ' + esc(S.auth.user)}</h2>
      <p>${esc(note || (signin ? 'Enter your passcode to sign in' : 'Enter your passcode'))}</p>
      <div class="dots${shake ? ' shake' : ''}">${signin
        ? Array.from({ length: Math.max(code.length, 6) }, (_, i) => `<i class="${i < code.length ? 'f' : ''}"></i>`).join('')
        : Array.from({ length: maxLen }, (_, i) => `<i class="${i < code.length ? 'f' : ''}"></i>`).join('')}</div>
      <div class="pad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}" ${waiting || busy ? 'disabled' : ''}>${n}</button>`).join('')}
        <button class="ghost" data-k="clear" ${busy ? 'disabled' : ''}>Clear</button>
        <button data-k="0" ${waiting || busy ? 'disabled' : ''}>0</button>
        <button class="ghost" data-k="back" ${busy ? 'disabled' : ''}>Delete</button>
      </div>
      <div class="msg">${esc(msg)}</div>
      <div class="lock-actions">
        ${signin ? `<button class="go" data-k="go" ${code.length < 4 || busy ? 'disabled' : ''}>${busy ? 'Signing in…' : 'Sign in'}</button>` : ''}
        ${!signin ? `<button data-k="out">Not ${esc(S.auth.user)}? Sign out</button>` : ''}
      </div>`;
  };

  const tryUnlock = async () => {
    busy = true; draw();
    const ok = (await hashCode(code, S.auth.salt)) === S.auth.hash;
    busy = false;
    if (ok) { unlock(); return; }
    fails++; code = '';
    if (fails >= 5) { waitUntil = Date.now() + 30000; fails = 0; draw('Too many tries — wait 30 seconds', true); setTimeout(() => draw(), 30100); }
    else draw('Wrong passcode', true);
  };

  const trySignIn = async () => {
    busy = true; draw();
    try {
      const r = await api('POST', '/login', { passcode: code });
      const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
      const prev = S.auth;
      S.auth = { user: r.user, token: r.token, salt, hash: await hashCode(code, salt), len: code.length };
      writeAuth(S.auth);
      if (prev && prev.user && prev.user !== r.user) { /* single-user app */ }
      busy = false;
      unlock();
    } catch (e) {
      busy = false; code = '';
      draw(e.network ? 'No connection — signing in needs signal the first time' : e.message, !e.network);
    }
  };

  lockEl.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-k]');
    if (!b || b.disabled) return;
    const k = b.dataset.k;
    if (k === 'out') { signOut(); return; }
    if (k === 'go') { trySignIn(); return; }
    if (k === 'clear') code = '';
    else if (k === 'back') code = code.slice(0, -1);
    else if (code.length < maxLen) code += k;
    draw();
    if (!signin && code.length === maxLen) tryUnlock();
  });
  draw();
}

function unlock() {
  S.unlocked = true;
  if (lockEl) { lockEl.remove(); lockEl = null; }
  if (!document.querySelector('.top')) renderShell();
  renderList(); renderStatus();
  sync().then(() => { if (FEATURES.rem) refreshPush(); });
}

function lockNow() { closeSheet(); showLock('unlock'); }

async function signOut() {
  if (S.outbox.length && !(await askConfirm('Sign out?', `${S.outbox.length} change${S.outbox.length > 1 ? 's have' : ' has'} not synced yet and will be lost.`, 'Sign out', true))) return;
  writeAuth(null);
  try { await idb.clear('kv'); await idb.clear('blobs'); } catch {}
  location.reload();
}

// ---------------------------------------------------------------- main screen
function renderShell() {
  $app.innerHTML = `
    <header class="top">
      <div class="top-row">
        <h1>Life Costs</h1>
        <button class="pill" id="status"><span class="dot"></span><span class="txt">…</span></button>
        <button class="icon-btn" id="settingsBtn" aria-label="Settings">${I.gear}</button>
      </div>
      <div class="tabs${FEATURES.rem || FEATURES.dash ? '' : ' hidden'}" role="tablist">
        <button role="tab" data-view="list">Spends</button>
        ${FEATURES.rem ? '<button role="tab" data-view="rem">Reminders<span class="tab-badge hidden" id="remBadge"></span></button>' : ''}
        ${FEATURES.dash ? '<button role="tab" data-view="dash">Dashboard</button>' : ''}
      </div>
      <div class="search-row" id="searchRow">
        <label class="search">${I.search}<input id="q" type="search" placeholder="Search spends" autocomplete="off" enterkeyhint="search"></label>
        <button class="filter-btn" id="filterBtn" aria-label="Filter">${I.filter}<span>Filter</span></button>
      </div>
    </header>
    <main id="list"></main>
    <main id="rem" class="hidden"></main>
    <main id="dash" class="dash hidden"></main>
    <button class="fab" id="addBtn">${I.plus}<span>Add spend</span></button>`;
  document.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (b) setView(b.dataset.view);
  });
  setupDash();
  setView(S.view, true);
  const q = document.getElementById('q');
  q.value = S.filter.q;
  q.addEventListener('input', () => { S.filter.q = q.value; renderList(); });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') q.blur(); });
  document.getElementById('addBtn').onclick = () => (S.view === 'rem' ? openRem(null) : openEdit(null));
  document.getElementById('filterBtn').onclick = openFilter;
  document.getElementById('settingsBtn').onclick = openSettings;
  document.getElementById('status').onclick = () => { sync().then(() => toast(statusText().long)); };
  document.getElementById('list').addEventListener('click', (e) => {
    const chipX = e.target.closest('[data-unfilter]');
    if (chipX) { const k = chipX.dataset.unfilter; if (k === 'dates') { S.filter.from = ''; S.filter.to = ''; } else S.filter[k] = k === 'est' ? false : ''; if (k === 'q') document.getElementById('q').value = ''; renderList(); return; }
    if (e.target.closest('[data-allrem]')) { setView('rem'); return; }
    const rr = e.target.closest('[data-rem]');
    if (rr) { openRem(rr.dataset.rem); return; }
    const row = e.target.closest('[data-id]');
    if (row) openEdit(row.dataset.id);
  });
  document.getElementById('rem').addEventListener('click', (e) => {
    const rr = e.target.closest('[data-rem]');
    if (rr) openRem(rr.dataset.rem);
  });
}

function statusText() {
  const n = new Set(S.outbox.map((o) => o.spend || o.id)).size;
  if (S.sync.busy) return { cls: 'wait', short: 'Syncing…', long: 'Syncing…' };
  if (S.sync.offline) return n ? { cls: 'wait', short: `${n} to sync`, long: `Offline — ${n} change${n > 1 ? 's' : ''} will sync when you have signal` } : { cls: 'off', short: 'Offline', long: 'Offline — showing what was last synced' };
  if (S.sync.error) return { cls: 'bad', short: 'Sync problem', long: 'Sync problem: ' + S.sync.error };
  if (n) return { cls: 'wait', short: `${n} to sync`, long: `${n} change${n > 1 ? 's' : ''} waiting to sync` };
  return { cls: '', short: 'Synced', long: S.sync.last ? 'All synced at ' + fmtTime(S.sync.last) : 'Synced' };
}
function renderStatus() {
  const el = document.getElementById('status');
  if (!el) return;
  const s = statusText();
  el.className = 'pill ' + s.cls;
  el.querySelector('.txt').textContent = s.short;
}

const ACCOUNTS = [['debit', 'HSBC debit'], ['credit', 'Barclaycard'], ['cash', 'Cash']];
const acctName = (a) => (ACCOUNTS.find(([k]) => k === a) || [0, ''])[1];
const lastAcct = () => (ACCOUNTS.some(([k]) => k === pref.get('lastAcct', '')) ? pref.get('lastAcct', '') : 'debit');
const acctSeg = (id, cur, disabled) => `<div class="seg" id="${id}">${ACCOUNTS.map(([k, l]) => `<button type="button" data-a="${k}" class="${k === cur ? 'on' : ''}" ${disabled ? 'disabled' : ''}>${l}</button>`).join('')}</div>`;
function bindAcctSeg(root, id, onPick) {
  const box = root.querySelector('#' + id);
  if (!box) return;
  box.onclick = (e) => {
    const b = e.target.closest('[data-a]');
    if (!b || b.disabled) return;
    box.querySelectorAll('[data-a]').forEach((x) => x.classList.toggle('on', x === b));
    onPick(b.dataset.a);
  };
}
const catName = (id) => (S.cats[id] ? S.cats[id].name : 'No category');
const sortedCats = (includeHidden) => Object.values(S.cats)
  .filter((c) => includeHidden || !c.hidden)
  .sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name));
const photosFor = (spendId) => Object.values(S.photos).filter((p) => p.spend_id === spendId).sort((a, b) => (a.created_at || 0) - (b.created_at || 0));

function filteredSpends() {
  const f = S.filter;
  const q = f.q.trim().toLowerCase();
  return Object.values(S.spends).filter((s) => {
    if (f.cat === '__none' ? !!s.category_id : (f.cat && s.category_id !== f.cat)) return false;
    if (f.from && s.date < f.from) return false;
    if (f.to && s.date > f.to) return false;
    if (f.est && !s.estimated) return false;
    if (f.acct && (s.account || '') !== (f.acct === '__none' ? '' : f.acct)) return false;
    if (q) {
      const hay = [s.description, s.supplier, s.notes, catName(s.category_id), acctName(s.account), money(s.amount_pence), penceToInput(s.amount_pence), fmtDate(s.date)].join(' ').toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  }).sort((a, b) => (b.date.localeCompare(a.date)) || ((b.created_at || 0) - (a.created_at || 0)));
}

function filterActive() { const f = S.filter; return !!(f.cat || f.from || f.to || f.est || f.acct); }

function renderList() {
  if (S.view === 'dash') renderDash(); else if (S.view === 'rem') renderRems(); else renderSpendList();
  renderBadge();
}

function renderSpendList() {
  const el = document.getElementById('list');
  if (!el) return;
  const fb = document.getElementById('filterBtn');
  if (fb) fb.classList.toggle('on', filterActive());
  const list = filteredSpends();
  const pend = pendingIds();
  const f = S.filter;
  const chips = [];
  if (f.q.trim()) chips.push(['q', 'Search', f.q.trim()]);
  if (f.cat) chips.push(['cat', 'Category', catName(f.cat)]);
  if (f.from || f.to) chips.push(['dates', 'Dates', (f.from ? fmtDate(f.from) : 'Start') + ' – ' + (f.to ? fmtDate(f.to) : 'today')]);
  if (f.est) chips.push(['est', 'Only', 'estimated']);
  if (f.acct) chips.push(['acct', 'Paid with', f.acct === '__none' ? 'Not set' : acctName(f.acct)]);

  const total = list.reduce((t, s) => t + s.amount_pence, 0);
  let html = chips.length ? `<div class="chips">${chips.map(([k, l, v]) => `<span class="chip">${esc(l)}: <b>${esc(v)}</b><button data-unfilter="${k}" aria-label="Remove">×</button></span>`).join('')}</div>` : '';

  if (!chips.length && FEATURES.rem) html += dueStrip();
  if (!Object.keys(S.spends).length) {
    el.innerHTML = html + `<div class="empty"><h2>No spends yet</h2>Tap <b>Add spend</b> to log the first one.<br>You can add past spends with their original date.</div>`;
    return;
  }
  html += `<div class="summary"><span>${list.length} spend${list.length === 1 ? '' : 's'}${chips.length ? ' found' : ''}</span><strong class="num">${money(total)}</strong></div>`;
  if (!list.length) { el.innerHTML = html + `<div class="empty"><h2>Nothing matches</h2>Try a different search or clear the filters.</div>`; return; }

  const groups = new Map();
  list.forEach((s) => { const k = s.date.slice(0, 7); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); });
  groups.forEach((items, ym) => {
    const sum = items.reduce((t, s) => t + s.amount_pence, 0);
    html += `<div class="month"><span>${esc(fmtMonth(ym))}</span><span class="num">${money(sum)}</span></div><div class="card">`;
    items.forEach((s) => {
      const d = parseISO(s.date);
      const nPh = photosFor(s.id).length;
      const sub = [s.supplier, catName(s.category_id)].filter(Boolean).map(esc).join(' · ');
      const waiting = pend.has(s.id) || photosFor(s.id).some((p) => p.pending);
      html += `<button class="row" data-id="${esc(s.id)}">
        <div class="date-badge"><div class="d num">${d.getDate()}</div><div class="w">${d.toLocaleDateString('en-GB', { weekday: 'short' })}</div></div>
        <div class="row-main">
          <div class="row-title">${esc(s.description)}</div>
          <div class="row-sub">${s.estimated ? '<span class="tag-est">Est.</span>' : ''}${s.regular_id ? `<span class="rp-ico" title="Regular payment">${I.repeat}</span>` : ''}${nPh ? I.clip : ''}<span>${sub}</span></div>
        </div>
        <div class="row-amt"><div class="a num">${money(s.amount_pence)}</div><div class="who">${waiting ? `<span class="tag-wait">Waiting</span>` : esc(acctName(s.account))}</div></div>
      </button>`;
    });
    html += `</div>`;
  });
  el.innerHTML = html;
}

// ---------------------------------------------------------------- views
function setView(view, initial) {
  S.view = (view === 'dash' && FEATURES.dash) || (view === 'rem' && FEATURES.rem) ? view : 'list';
  pref.set('view', S.view);
  document.querySelectorAll('.tabs [data-view]').forEach((b) => {
    const on = b.dataset.view === S.view;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const dash = S.view === 'dash', rem = S.view === 'rem';
  document.getElementById('list').classList.toggle('hidden', dash || rem);
  document.getElementById('rem').classList.toggle('hidden', !rem);
  document.getElementById('dash').classList.toggle('hidden', !dash);
  document.getElementById('searchRow').classList.toggle('hidden', dash || rem);
  const add = document.getElementById('addBtn');
  add.classList.toggle('hidden', dash);
  add.querySelector('span').textContent = rem ? 'Add reminder' : 'Add spend';
  if (!initial) { window.scrollTo(0, 0); renderList(); }
}

// Jump from the dashboard to the spend list with a filter applied.
function showSpends(filter) {
  Object.assign(S.filter, { q: '', cat: '', from: '', to: '', est: false, acct: '' }, filter);
  const q = document.getElementById('q');
  if (q) q.value = '';
  setView('list');
}

// ---------------------------------------------------------------- dashboard
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const wholePounds = (p) => '£' + Math.round((p || 0) / 100).toLocaleString('en-GB');
const shortPounds = (p) => {
  const v = (p || 0) / 100;
  if (v >= 1000) return '£' + (v / 1000).toLocaleString('en-GB', { maximumFractionDigits: v >= 10000 ? 0 : 1 }) + 'k';
  return '£' + Math.round(v).toLocaleString('en-GB');
};
const sumP = (list) => list.reduce((t, s) => t + (s.amount_pence || 0), 0);
const allSpends = () => Object.values(S.spends);
const yearOf = (s) => +s.date.slice(0, 4);

function niceScale(max) {
  if (max <= 0) return { top: 10000, step: 2500 };
  const raw = max / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  return { step, top: Math.ceil(max / step) * step };
}

function dashYears() {
  const ys = new Set(allSpends().map(yearOf));
  ys.add(new Date().getFullYear());
  return [...ys].sort((a, b) => b - a);
}

let dashResize = null;
function setupDash() {
  const el = document.getElementById('dash');
  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const y = S.dashYear;
    const yr = { from: `${y}-01-01`, to: `${y}-12-31` };
    const act = t.dataset.act;
    if (act === 'cat') showSpends(Object.assign({ cat: t.dataset.cat }, yr));
    else if (act === 'est') showSpends(Object.assign({ est: true }, yr));
    else if (act === 'spend') openEdit(t.dataset.id);
    else if (act === 'yearcell') showSpends({ cat: t.dataset.cat || '', from: `${t.dataset.y}-01-01`, to: `${t.dataset.y}-12-31` });
    else if (act === 'export') openExport();
    else if (act === 'add') openEdit(null);
  });
  el.addEventListener('change', (e) => {
    if (e.target.id === 'dashYear') { S.dashYear = +e.target.value; renderDash(); }
  });
  if ('ResizeObserver' in window) {
    let w = 0;
    new ResizeObserver((entries) => {
      const nw = Math.round(entries[0].contentRect.width);
      if (nw === w) return;
      w = nw;
      clearTimeout(dashResize);
      dashResize = setTimeout(() => { if (S.view === 'dash') drawMonthChart(); }, 80);
    }).observe(el);
  }
}

function renderDash() {
  const el = document.getElementById('dash');
  if (!el) return;
  const all = allSpends();
  const years = dashYears();
  if (!years.includes(S.dashYear)) S.dashYear = years[0];
  const y = S.dashYear;
  const now = new Date();
  const thisYear = now.getFullYear();
  const todayStr = today();

  if (!all.length) {
    el.innerHTML = `<div class="empty"><h2>Nothing to show yet</h2>Add some spends on your phone and the dashboard fills in here.</div>`;
    return;
  }

  const inYear = all.filter((s) => yearOf(s) === y);
  const yearTotal = sumP(inYear);

  // Comparison tile: same point last year for the current year, full previous year otherwise.
  let cmpLabel, cmpTotal, curForCmp;
  if (y === thisYear) {
    const cutoff = `${y - 1}-${todayStr.slice(5)}`;
    cmpTotal = sumP(all.filter((s) => yearOf(s) === y - 1 && s.date <= cutoff));
    curForCmp = sumP(inYear.filter((s) => s.date <= todayStr));
    cmpLabel = `By ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${y - 1}`;
  } else {
    cmpTotal = sumP(all.filter((s) => yearOf(s) === y - 1));
    curForCmp = yearTotal;
    cmpLabel = `Full year ${y - 1}`;
  }
  const diff = curForCmp - cmpTotal;
  let cmpNote;
  if (!cmpTotal) cmpNote = `No spends logged for ${y - 1}`;
  else {
    const pct = Math.round((diff / cmpTotal) * 100);
    cmpNote = diff === 0 ? 'Same as this year' : `${y} is ${wholePounds(Math.abs(diff))} ${diff > 0 ? 'higher' : 'lower'} (${diff > 0 ? '+' : '−'}${Math.abs(pct)}%)`;
  }

  const yearAgo = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); d.setDate(d.getDate() + 1); return isoDate(d); })();
  const last12 = sumP(all.filter((s) => s.date >= yearAgo && s.date <= todayStr));
  const allTime = sumP(all);
  const firstYear = Math.min(...all.map(yearOf));

  // By category for the chosen year
  const byCat = new Map();
  inYear.forEach((s) => { const k = s.category_id || '__none'; byCat.set(k, (byCat.get(k) || 0) + s.amount_pence); });
  const catRows = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const catMax = catRows.length ? catRows[0][1] : 0;

  // Biggest spends
  const top = inYear.slice().sort((a, b) => b.amount_pence - a.amount_pence || b.date.localeCompare(a.date)).slice(0, 10);

  // Estimated
  const est = inYear.filter((s) => s.estimated);
  const estTotal = sumP(est);
  const estShare = yearTotal ? estTotal / yearTotal : 0;

  // Year-on-year table
  const tableYears = years.slice().sort((a, b) => a - b);
  const cell = new Map(); // `${cat}|${year}` -> {p, est}
  const catAll = new Map();
  all.forEach((s) => {
    const k = (s.category_id || '__none') + '|' + yearOf(s);
    const c = cell.get(k) || { p: 0, est: false };
    c.p += s.amount_pence; if (s.estimated) c.est = true;
    cell.set(k, c);
    catAll.set(s.category_id || '__none', (catAll.get(s.category_id || '__none') || 0) + s.amount_pence);
  });
  const tableCats = [...catAll.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const yearTot = (yy) => { let p = 0, e = false; tableCats.forEach((c) => { const v = cell.get(c + '|' + yy); if (v) { p += v.p; e = e || v.est; } }); return { p, est: e }; };
  const anyEstInTable = [...cell.values()].some((c) => c.est);
  const estMark = (flag) => (flag ? '<span class="est-dot" title="Includes estimated costs">•</span>' : '');

  el.innerHTML = `
    <div class="dash-bar">
      <label class="year-pick"><span>Year</span>
        <select id="dashYear">${years.map((yy) => `<option value="${yy}" ${yy === y ? 'selected' : ''}>${yy}</option>`).join('')}</select>
      </label>
      <button class="mini" data-act="export">Export CSV</button>
    </div>

    <section class="tiles">
      <div class="tile hero">
        <div class="t-label">Spent in ${y}${y === thisYear ? ' so far' : ''}</div>
        <div class="t-value num">${money(yearTotal)}</div>
        <div class="t-note">${inYear.length} spend${inYear.length === 1 ? '' : 's'}</div>
      </div>
      <div class="tile">
        <div class="t-label">${esc(cmpLabel)}</div>
        <div class="t-value num">${money(cmpTotal)}</div>
        <div class="t-note">${esc(cmpNote)}</div>
      </div>
      <div class="tile">
        <div class="t-label">Last 12 months</div>
        <div class="t-value num">${money(last12)}</div>
        <div class="t-note">${esc(fmtDate(yearAgo))} to today</div>
      </div>
      <div class="tile">
        <div class="t-label">All time</div>
        <div class="t-value num">${money(allTime)}</div>
        <div class="t-note">Since ${firstYear} · ${all.length} spend${all.length === 1 ? '' : 's'}</div>
      </div>
    </section>

    <section class="dash-grid">
      <div class="panel span-wide">
        <div class="panel-head">
          <h3>By month</h3>
          <div class="legend"><span><i class="sw cur"></i>${y}</span><span><i class="sw prev"></i>${y - 1}</span></div>
        </div>
        <div class="chart" id="monthChart"></div>
        <p class="panel-foot">Hover or tap a month for figures · click to see its spends</p>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>By category</h3><span class="panel-sub">${y}</span></div>
        ${catRows.length ? `<div class="cat-bars">${catRows.map(([k, p]) => `
          <button class="cat-row" data-act="cat" data-cat="${esc(k)}">
            <span class="cat-name">${esc(catName(k))}</span>
            <span class="cat-track"><span class="cat-fill" style="width:${Math.max(1.5, (p / catMax) * 100).toFixed(1)}%"></span></span>
            <span class="cat-val num">${money(p)}</span>
            <span class="cat-pct num">${(p / yearTotal) * 100 < 1 ? '&lt;1' : Math.round((p / yearTotal) * 100)}%</span>
          </button>`).join('')}</div>` : `<p class="muted-note">No spends in ${y}.</p>`}
      </div>

      <div class="panel">
        <div class="panel-head"><h3>Biggest spends</h3><span class="panel-sub">${y}</span></div>
        ${top.length ? `<div class="top-list">${top.map((s, i) => `
          <button class="top-row" data-act="spend" data-id="${esc(s.id)}">
            <span class="top-rank num">${i + 1}</span>
            <span class="top-main"><span class="top-title">${esc(s.description)}</span>
              <span class="top-sub">${esc(fmtDate(s.date))} · ${esc(catName(s.category_id))}${s.supplier ? ' · ' + esc(s.supplier) : ''}</span></span>
            ${s.estimated ? '<span class="tag-est">Est.</span>' : ''}
            <span class="top-amt num">${money(s.amount_pence)}</span>
          </button>`).join('')}</div>` : `<p class="muted-note">No spends in ${y}.</p>`}
      </div>

      <div class="panel">
        <div class="panel-head"><h3>How firm the numbers are</h3><span class="panel-sub">${y}</span></div>
        ${est.length ? `
          <p class="firm-line"><strong class="num">${money(estTotal)}</strong> of <strong class="num">${money(yearTotal)}</strong> is estimated</p>
          <div class="firm-track" role="img" aria-label="${Math.round(estShare * 100)}% estimated"><span style="width:${Math.max(1.5, estShare * 100).toFixed(1)}%"></span></div>
          <p class="firm-note">${est.length} estimated spend${est.length === 1 ? '' : 's'} · ${Math.round(estShare * 100)}% of the year</p>
          <button class="mini" data-act="est">Show estimated spends</button>`
        : inYear.length ? `<p class="firm-line">All ${y} figures are exact. Nothing is marked estimated.</p>` : `<p class="muted-note">No spends in ${y}.</p>`}
      </div>

      <div class="panel span-full">
        <div class="panel-head"><h3>Year on year</h3><span class="panel-sub">by category</span></div>
        <div class="table-wrap">
          <table class="yoy">
            <thead><tr><th>Category</th>${tableYears.map((yy) => `<th class="num${yy === y ? ' sel' : ''}">${yy}</th>`).join('')}<th class="num">Total</th></tr></thead>
            <tbody>${tableCats.map((c) => {
              let rowP = 0, rowE = false;
              const tds = tableYears.map((yy) => {
                const v = cell.get(c + '|' + yy);
                if (v) { rowP += v.p; rowE = rowE || v.est; }
                return v ? `<td class="num${yy === y ? ' sel' : ''}"><button class="cell-btn" data-act="yearcell" data-cat="${esc(c)}" data-y="${yy}">${money(v.p)}${estMark(v.est)}</button></td>` : `<td class="num dim${yy === y ? ' sel' : ''}">–</td>`;
              }).join('');
              return `<tr><th scope="row">${esc(catName(c))}</th>${tds}<td class="num strong">${money(rowP)}${estMark(rowE)}</td></tr>`;
            }).join('')}</tbody>
            <tfoot><tr><th scope="row">Total</th>${tableYears.map((yy) => { const t = yearTot(yy); return `<td class="num${yy === y ? ' sel' : ''}">${t.p ? `<button class="cell-btn" data-act="yearcell" data-cat="" data-y="${yy}">${money(t.p)}${estMark(t.est)}</button>` : '–'}</td>`; }).join('')}<td class="num">${money(allTime)}${estMark(anyEstInTable)}</td></tr></tfoot>
          </table>
        </div>
        ${anyEstInTable ? `<p class="panel-foot"><span class="est-dot">•</span> includes estimated costs · click a figure to see its spends</p>` : `<p class="panel-foot">Click a figure to see its spends</p>`}
      </div>
    </section>`;
  drawMonthChart();
}

function monthTotals(year) {
  const m = new Array(12).fill(0);
  allSpends().forEach((s) => { if (yearOf(s) === year) m[+s.date.slice(5, 7) - 1] += s.amount_pence; });
  return m;
}

function drawMonthChart() {
  const box = document.getElementById('monthChart');
  if (!box) return;
  const y = S.dashYear;
  const cur = monthTotals(y), prev = monthTotals(y - 1);
  const W = Math.max(280, box.clientWidth || 600);
  const H = W < 500 ? 220 : 260;
  const m = { l: 52, r: 8, t: 14, b: 28 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const { top, step } = niceScale(Math.max(...cur, ...prev));
  const yv = (v) => m.t + ih - (v / top) * ih;
  const band = iw / 12;
  const bw = Math.max(3, Math.min(16, (band - 10) / 2));
  const gap = 2;
  const base = m.t + ih;
  const bar = (x, v, cls) => {
    if (v <= 0) return '';
    const h = Math.max(1.5, base - yv(v));
    const r = Math.min(4, bw / 2, h);
    const yt = base - h;
    return `<path class="${cls}" d="M${x},${base} V${yt + r} Q${x},${yt} ${x + r},${yt} H${x + bw - r} Q${x + bw},${yt} ${x + bw},${yt + r} V${base} Z"/>`;
  };
  let grid = '';
  for (let v = 0; v <= top + 1e-6; v += step) {
    const gy = yv(v).toFixed(1);
    grid += `<line class="${v === 0 ? 'axis' : 'grid'}" x1="${m.l}" x2="${W - m.r}" y1="${gy}" y2="${gy}"/>` +
      `<text class="tick" x="${m.l - 8}" y="${gy}" dy="0.32em" text-anchor="end">${shortPounds(v)}</text>`;
  }
  let bars = '', labels = '', hits = '';
  const nowY = new Date().getFullYear(), nowM = new Date().getMonth();
  for (let i = 0; i < 12; i++) {
    const cx = m.l + i * band + band / 2;
    bars += bar(cx - bw - gap / 2, prev[i], 'b-prev') + bar(cx + gap / 2, cur[i], 'b-cur');
    const future = y === nowY && i > nowM;
    labels += `<text class="mlabel${future ? ' future' : ''}" x="${cx}" y="${H - 8}" text-anchor="middle">${band < 30 ? MONTHS[i][0] : MONTHS[i]}</text>`;
    hits += `<rect class="hit" data-m="${i}" x="${m.l + i * band}" y="${m.t}" width="${band}" height="${ih + m.b}"/>`;
  }
  box.innerHTML = `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Spending by month, ${y} compared with ${y - 1}">
      ${grid}
      <rect class="col-hl" id="colHl" x="0" y="${m.t}" width="${band}" height="${ih}" rx="6" style="display:none"/>
      ${bars}${labels}${hits}
    </svg>
    <div class="tip hidden" id="monthTip"></div>`;
  const svgEl = box.querySelector('svg');
  const tip = box.querySelector('#monthTip');
  const hl = box.querySelector('#colHl');
  const show = (i) => {
    hl.setAttribute('x', m.l + i * band); hl.style.display = '';
    tip.innerHTML = `<div class="tip-h">${MONTHS[i]}</div>
      <div><i class="sw cur"></i>${y}<b class="num">${money(cur[i])}</b></div>
      <div><i class="sw prev"></i>${y - 1}<b class="num">${money(prev[i])}</b></div>`;
    tip.classList.remove('hidden');
    const cx = m.l + i * band + band / 2;
    const tw = tip.offsetWidth;
    tip.style.left = Math.min(W - tw - 4, Math.max(4, cx - tw / 2)) + 'px';
    tip.style.top = '4px';
  };
  const hide = () => { tip.classList.add('hidden'); hl.style.display = 'none'; };
  svgEl.addEventListener('pointermove', (e) => { const r = e.target.closest('.hit'); if (r) show(+r.dataset.m); });
  svgEl.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
  svgEl.addEventListener('click', (e) => {
    const r = e.target.closest('.hit');
    if (!r) return;
    const i = +r.dataset.m;
    // On touch: first tap shows the figures, second tap on the same month opens its spends.
    if (e.pointerType !== 'mouse' && box.dataset.tapped !== String(i)) { box.dataset.tapped = String(i); show(i); return; }
    box.dataset.tapped = '';
    if (!cur[i]) { show(i); return; }
    const mm = pad2(i + 1);
    const last = new Date(y, i + 1, 0).getDate();
    showSpends({ from: `${y}-${mm}-01`, to: `${y}-${mm}-${pad2(last)}` });
  });
}

// ---------------------------------------------------------------- CSV export
function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;            // stop Excel treating text as a formula
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const ukDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const ukStamp = (ms) => { if (!ms) return ''; const d = new Date(ms); return `${ukDate(isoDate(d))} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

function exportCsv(year) {
  const rows = allSpends()
    .filter((s) => !year || yearOf(s) === year)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.created_at || 0) - (b.created_at || 0));
  const head = ['Date', 'What', 'Supplier', 'Category', 'Paid with', 'Cost (£)', 'Estimated', 'Regular payment', 'Notes', 'Receipts & bills', 'Added by', 'Added on', 'Last changed by', 'Last changed on'];
  const lines = [head.map(csvCell).join(',')];
  rows.forEach((s) => {
    const changed = s.updated_at && s.created_at && s.updated_at !== s.created_at;
    lines.push([
      ukDate(s.date), s.description, s.supplier || '', s.category_id ? catName(s.category_id) : '', acctName(s.account),
      (s.amount_pence / 100).toFixed(2), s.estimated ? 'Yes' : 'No',
      s.regular_id ? ((S.regulars[s.regular_id] && S.regulars[s.regular_id].description) || 'Yes') : '', s.notes || '', photosFor(s.id).length,
      s.created_by || '', ukStamp(s.created_at), changed ? s.updated_by || '' : '', changed ? ukStamp(s.updated_at) : '',
    ].map(csvCell).join(','));
  });
  const blob = new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `life-costs-${year || 'all-years'}-${today()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast(`Exported ${rows.length} spend${rows.length === 1 ? '' : 's'}`);
}

function openExport() {
  const y = S.dashYear;
  const nYear = allSpends().filter((s) => yearOf(s) === y).length;
  const nAll = allSpends().length;
  const d = document.createElement('div');
  d.className = 'sheet';
  d.style.cssText = 'z-index:45;background:rgba(10,20,28,.45);justify-content:flex-end;';
  d.innerHTML = `<div style="background:var(--bg);border-radius:18px 18px 0 0;padding:20px 16px calc(var(--safe-bottom) + 20px)">
      <div style="max-width:560px;margin:0 auto">
        <h3 style="margin:0 0 6px;font-size:18px;text-align:center">Export to CSV</h3>
        <p style="margin:0 0 18px;color:var(--muted);text-align:center">Opens in Excel. Costs are in pounds; dates are day/month/year.</p>
        <button class="btn primary" data-x="year" ${nYear ? '' : 'disabled'}>${y} only (${nYear} spend${nYear === 1 ? '' : 's'})</button>
        <button class="btn plain" data-x="all">All years (${nAll} spend${nAll === 1 ? '' : 's'})</button>
        <button class="btn plain" data-x="cancel">Cancel</button>
      </div></div>`;
  d.addEventListener('click', (e) => {
    const b = e.target.closest('[data-x]');
    if (b && b.disabled) return;
    if (b || e.target === d) d.remove();
    if (b && b.dataset.x === 'year') exportCsv(y);
    if (b && b.dataset.x === 'all') exportCsv(0);
  });
  document.body.appendChild(d);
}

// ---------------------------------------------------------------- sheets
let sheetCleanup = [];
function openSheet({ title, left = 'Cancel', right = '', body, onRight, onLeft }) {
  closeSheet();
  $ov.innerHTML = `
    <div class="sheet" role="dialog" aria-label="${esc(title)}">
      <div class="sheet-head">
        <button class="text-btn left" data-act="left">${esc(left)}</button>
        <h2>${esc(title)}</h2>
        <button class="text-btn right" data-act="right" ${right ? '' : 'style="visibility:hidden"'}>${esc(right || '·')}</button>
      </div>
      <div class="sheet-body">${body}</div>
    </div>`;
  const sh = $ov.firstElementChild;
  sh.querySelector('[data-act=left]').onclick = () => (onLeft ? onLeft() : closeSheet());
  if (right) sh.querySelector('[data-act=right]').onclick = () => onRight && onRight();
  return sh;
}
function closeSheet() {
  sheetCleanup.forEach((fn) => { try { fn(); } catch {} });
  sheetCleanup = [];
  $ov.innerHTML = '';
}

function askConfirm(title, text, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    const d = document.createElement('div');
    d.className = 'sheet';
    d.style.cssText = 'z-index:45;background:rgba(10,20,28,.45);justify-content:flex-end;';
    d.innerHTML = `<div style="background:var(--bg);border-radius:18px 18px 0 0;padding:20px 16px calc(var(--safe-bottom) + 20px)">
        <div style="max-width:560px;margin:0 auto">
          <h3 style="margin:0 0 6px;font-size:18px;text-align:center">${esc(title)}</h3>
          <p style="margin:0 0 18px;color:var(--muted);text-align:center">${esc(text)}</p>
          <button class="btn ${danger ? 'danger' : 'primary'}" data-v="1">${esc(okLabel)}</button>
          <button class="btn plain" data-v="0">Cancel</button>
        </div></div>`;
    d.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (b) { d.remove(); resolve(b.dataset.v === '1'); }
      else if (e.target === d) { d.remove(); resolve(false); }
    });
    document.body.appendChild(d);
  });
}

// ---------------------------------------------------------------- photos
async function compressImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Could not read that photo'));
      i.src = url;
    });
    const max = 1600;
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    let q = 0.72;
    let blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
    while (blob && blob.size > 1_200_000 && q > 0.35) { q -= 0.12; blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q)); }
    if (!blob) throw new Error('Could not process that photo');
    return blob;
  } finally { URL.revokeObjectURL(url); }
}

async function photoBlob(id) {
  let blob = await idb.get('blobs', id).catch(() => null);
  if (blob) return blob;
  const p = S.photos[id];
  if (!p || p.pending) return null;
  const res = await api('GET', '/photos/' + id, undefined, { raw: true, timeout: 30000 });
  blob = await res.blob();
  idb.set('blobs', id, blob).catch(() => {});
  return blob;
}

const MAX_PDF_BYTES = 5_000_000;
const isPdfBlob = (b) => !!b && (b.type === 'application/pdf');
const fmtSize = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB');

function openPdfViewer(blob) {
  const url = URL.createObjectURL(blob);
  const v = document.createElement('div');
  v.className = 'viewer pdf';
  v.innerHTML = `<iframe src="${url}" title="PDF"></iframe>
    <div class="pdf-bar"><a class="pdf-open" href="${url}" target="_blank" rel="noopener">Open full PDF</a><button class="pdf-close">Close</button></div>`;
  v.querySelector('.pdf-close').onclick = () => { v.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); };
  document.body.appendChild(v);
}

function openViewer(blob) {
  if (isPdfBlob(blob)) { openPdfViewer(blob); return; }
  const url = URL.createObjectURL(blob);
  const v = document.createElement('div');
  v.className = 'viewer';
  v.innerHTML = `<img src="${url}" alt="Receipt photo"><button>Close</button>`;
  v.onclick = () => { URL.revokeObjectURL(url); v.remove(); };
  document.body.appendChild(v);
}

// ---------------------------------------------------------------- add / edit spend
function openEdit(id, prefill) {
  const existing = id ? S.spends[id] : null;
  if (id && !existing) return;
  const s = existing || Object.assign({
    id: uid(), date: today(), description: '', supplier: '', amount_pence: null,
    category_id: S.cats[pref.get('lastCat', '')] && !S.cats[pref.get('lastCat', '')].hidden ? pref.get('lastCat', '') : '',
    notes: '', estimated: 0, account: lastAcct(),
  }, prefill || {});
  let account = s.account || '';
  const form = { photos: photosFor(s.id).map((p) => ({ id: p.id, existing: true, removed: false, pdf: p.mime === 'application/pdf', size: p.size })) };
  const urls = [];
  sheetCleanup.push(() => urls.forEach((u) => URL.revokeObjectURL(u)));

  const cats = sortedCats(false);
  if (s.category_id && S.cats[s.category_id] && S.cats[s.category_id].hidden) cats.push(S.cats[s.category_id]);
  const freq = (key) => {
    const m = new Map();
    Object.values(S.spends).forEach((x) => { const v = (x[key] || '').trim(); if (v) m.set(v, (m.get(v) || 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([v]) => `<option value="${esc(v)}">`).join('');
  };

  const regOf = existing && existing.regular_id ? S.regulars[existing.regular_id] : null;
  const metaLine = existing
    ? (existing.regular_id ? `Added automatically by the regular payment${regOf ? ' “' + esc(regOf.description) + '”' : ''}${existing.manual ? ' (edited since)' : ''}<br>` : '') +
      `Added by ${esc(existing.created_by || '?')}${existing.created_at ? ', ' + esc(fmtStamp(existing.created_at)) : ''}` +
      (existing.updated_by && existing.updated_at && existing.updated_at !== existing.created_at ? `<br>Last changed by ${esc(existing.updated_by)}, ${esc(fmtStamp(existing.updated_at))}` : '')
    : '';

  const sh = openSheet({
    title: existing ? 'Edit spend' : 'New spend',
    right: 'Save',
    onRight: () => save(),
    body: `
      <p class="form-error hidden" id="fErr"></p>
      <div class="group">
        <div class="field" id="fDescW"><label for="fDesc">What was it?</label>
          <input id="fDesc" list="dlDesc" value="${esc(s.description)}" placeholder="e.g. Weekly shop" autocomplete="off" enterkeyhint="next"></div>
        <div class="field" id="fAmtW"><label for="fAmt">Cost</label>
          <div class="money"><span>£</span><input id="fAmt" inputmode="decimal" value="${s.amount_pence != null ? penceToInput(s.amount_pence) : ''}" placeholder="0.00" autocomplete="off"></div></div>
        <div class="field" id="fDateW"><label for="fDate">Date</label>
          <input id="fDate" type="date" value="${esc(s.date)}" max="${today()}"></div>
      </div>
      <div class="group">
        <div class="field"><label for="fCat">Category</label>
          <select id="fCat">
            <option value="">Choose…</option>
            ${cats.map((c) => `<option value="${esc(c.id)}" ${c.id === s.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            <option value="__new">＋ New category…</option>
          </select></div>
        <div class="field hidden" id="fNewCatW"><label for="fNewCat">New category name</label>
          <input id="fNewCat" placeholder="e.g. Dog" autocomplete="off"></div>
        <div class="field"><label for="fSup">Supplier</label>
          <input id="fSup" list="dlSup" value="${esc(s.supplier)}" placeholder="Optional" autocomplete="off"></div>
      </div>
      <div class="group-title">Paid with</div>
      <div class="group" id="fAcctW">${acctSeg('fAcct', account)}</div>
      <div class="group">
        <label class="toggle"><span class="t-text">Estimated<small>Not sure of the exact figure</small></span>
          <span class="switch"><input type="checkbox" id="fEst" ${s.estimated ? 'checked' : ''}><span></span></span></label>
      </div>
      <div class="group-title">Receipts &amp; bills</div>
      <div class="group"><div class="photos" id="fPhotos"></div></div>
      <input type="file" id="fFile" accept="image/*,application/pdf,.pdf" multiple class="hidden">
      <div class="group">
        <div class="field"><label for="fNotes">Notes</label>
          <textarea id="fNotes" placeholder="Optional">${esc(s.notes)}</textarea></div>
      </div>
      ${metaLine ? `<p class="meta-line">${metaLine}</p>` : ''}
      ${existing ? `<button class="btn danger" id="fDel">Delete spend</button>` : `<button class="btn primary" id="fSave">Save spend</button>`}
      <datalist id="dlDesc">${freq('description')}</datalist>
      <datalist id="dlSup">${freq('supplier')}</datalist>`,
  });

  const $ = (sel) => sh.querySelector(sel);
  const catSel = $('#fCat');
  bindAcctSeg(sh, 'fAcct', (a) => { account = a; });
  catSel.onchange = () => { $('#fNewCatW').classList.toggle('hidden', catSel.value !== '__new'); if (catSel.value === '__new') $('#fNewCat').focus(); };
  if (!existing) setTimeout(() => $(prefill && prefill.description ? '#fAmt' : '#fDesc').focus(), 250);

  const drawPhotos = () => {
    const box = $('#fPhotos');
    box.innerHTML = form.photos.filter((p) => !p.removed).map((p) => p.pdf
      ? `<div class="thumb pdf-thumb" data-ph="${esc(p.id)}">${I.doc}<span>PDF</span><small>${p.size ? fmtSize(p.size) : ''}</small><button class="x" data-rm="${esc(p.id)}" aria-label="Remove PDF">×</button></div>`
      : `<div class="thumb" data-ph="${esc(p.id)}"><div class="ph">Loading…</div><button class="x" data-rm="${esc(p.id)}" aria-label="Remove photo">×</button></div>`).join('') +
      `<button class="add-photo" id="fAddPh">${I.camera}<span>Photo or PDF</span></button>`;
    form.photos.filter((p) => !p.removed && !p.pdf).forEach(async (p) => {
      const holder = box.querySelector(`[data-ph="${CSS.escape(p.id)}"]`);
      try {
        const blob = p.blob || (await photoBlob(p.id));
        if (!blob) throw new Error();
        p.view = blob;
        const u = URL.createObjectURL(blob); urls.push(u);
        holder.querySelector('.ph').outerHTML = `<img src="${u}" alt="Receipt">`;
      } catch { const ph = holder && holder.querySelector('.ph'); if (ph) ph.textContent = 'Offline'; }
    });
  };
  drawPhotos();

  $('#fPhotos').addEventListener('click', async (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { e.stopPropagation(); const p = form.photos.find((x) => x.id === rm.dataset.rm); if (p) p.removed = true; drawPhotos(); return; }
    if (e.target.closest('#fAddPh')) { $('#fFile').click(); return; }
    const th = e.target.closest('[data-ph]');
    if (th) {
      const p = form.photos.find((x) => x.id === th.dataset.ph);
      if (!p) return;
      if (p.pdf) {
        try {
          const blob = p.blob || (await photoBlob(p.id));
          if (!blob) throw new Error();
          openPdfViewer(blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' }));
        } catch { toast('This PDF needs signal to open the first time'); }
      } else if (p.view) openViewer(p.view);
    }
  });
  $('#fFile').onchange = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    for (const f of files) {
      const pdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
      if (pdf) {
        if (f.size > MAX_PDF_BYTES) { toast(`${f.name || 'That PDF'} is ${fmtSize(f.size)} — the limit is 5 MB`, 4000); continue; }
        const blob = f.type === 'application/pdf' ? f : new Blob([f], { type: 'application/pdf' });
        form.photos.push({ id: uid(), existing: false, pdf: true, size: f.size, blob });
        continue;
      }
      try { form.photos.push({ id: uid(), existing: false, blob: await compressImage(f) }); }
      catch (err) { toast(err.message); }
    }
    drawPhotos();
  };

  if (existing) {
    $('#fDel').onclick = async () => {
      if (!(await askConfirm('Delete this spend?', `${s.description} — ${money(s.amount_pence)}. This can't be undone.`, 'Delete', true))) return;
      const neverSent = !existing.seq;
      S.outbox = S.outbox.filter((o) => o.sending || !(o.id === s.id || o.spend === s.id));
      photosFor(s.id).forEach((p) => idb.del('blobs', p.id).catch(() => {}));
      removeSpendLocally(s.id);
      if (!neverSent) queue({ t: 'del', id: s.id }); else saveOutbox();
      closeSheet(); renderList(); renderStatus();
      toast('Deleted');
      sync();
    };
  } else {
    $('#fSave').onclick = () => save();
  }

  function fail(msg, fieldId) {
    sh.querySelectorAll('.field.err').forEach((x) => x.classList.remove('err'));
    if (fieldId) $(fieldId).classList.add('err');
    const e = $('#fErr'); e.textContent = msg; e.classList.remove('hidden');
    sh.querySelector('.sheet-body').scrollTop = 0;
  }

  async function save() {
    const description = $('#fDesc').value.trim();
    const amount = parseMoney($('#fAmt').value);
    const date = $('#fDate').value;
    if (!description) return fail('Say what it was', '#fDescW');
    if (amount == null) return fail('Enter the cost, e.g. 45.99', '#fAmtW');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('Choose the date', '#fDateW');

    let category_id = catSel.value;
    if (category_id === '__new') {
      const name = $('#fNewCat').value.trim();
      if (!name) return fail('Name the new category');
      const dupe = Object.values(S.cats).find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (dupe) {
        category_id = dupe.id;
        if (dupe.hidden) { dupe.hidden = 0; queue({ t: 'cat', id: dupe.id, rec: { name: dupe.name, sort: dupe.sort, hidden: 0 } }); }
      } else {
        category_id = 'cat-' + uid().slice(0, 12);
        const sort = Math.max(0, ...Object.values(S.cats).map((c) => c.sort || 0)) + 10;
        S.cats[category_id] = { id: category_id, name, sort, hidden: 0 };
        queue({ t: 'cat', id: category_id, rec: { name, sort, hidden: 0 } });
      }
    }
    if (category_id) pref.set('lastCat', category_id);
    if (account) pref.set('lastAcct', account);

    const rec = { date, description, supplier: $('#fSup').value.trim(), amount_pence: amount, category_id: category_id || null, account: account || null, notes: $('#fNotes').value.trim(), estimated: $('#fEst').checked ? 1 : 0 };
    const photoChange = form.photos.some((p) => (!p.existing && !p.removed) || (p.existing && p.removed));
    if (existing && !photoChange && Object.keys(rec).every((k) => (rec[k] ?? null) === (existing[k] ?? null) || (k === 'estimated' && !rec[k] === !existing[k]))) {
      closeSheet(); return; // nothing changed (keeps regular payments linked to price changes)
    }
    const now = Date.now();
    S.spends[s.id] = Object.assign({}, existing || { id: s.id, created_by: S.auth.user, created_at: now }, rec, existing ? { updated_by: S.auth.user, updated_at: now } : {}, existing && existing.regular_id ? { manual: 1 } : {});
    queue({ t: 'spend', id: s.id, rec });

    for (const p of form.photos) {
      if (!p.existing && !p.removed) {
        try { await idb.set('blobs', p.id, p.blob); } catch { toast('Could not store a photo on this phone'); continue; }
        S.photos[p.id] = { id: p.id, spend_id: s.id, mime: p.blob.type || 'image/jpeg', size: p.blob.size, created_by: S.auth.user, created_at: Date.now(), pending: true };
        queue({ t: 'photo', id: p.id, spend: s.id });
      } else if (p.existing && p.removed) {
        const unsent = S.outbox.findIndex((o) => o.t === 'photo' && o.id === p.id && !o.sending);
        delete S.photos[p.id];
        if (unsent >= 0) { S.outbox.splice(unsent, 1); saveOutbox(); }
        else queue({ t: 'delphoto', id: p.id });
        idb.del('blobs', p.id).catch(() => {});
      }
    }
    saveData();
    closeSheet(); renderList(); renderStatus();
    toast(navigator.onLine ? 'Saved' : 'Saved — will sync when you have signal');
    sync();
  }
}

// ---------------------------------------------------------------- reminders
const daysUntil = (iso) => Math.round((parseISO(iso) - parseISO(today())) / 864e5);
const shortDate = (iso) => parseISO(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
// Move a date on by n months, keeping the original day where the month allows (31 Jan -> 28 Feb -> 31 Mar).
function addMonths(iso, n, anchor) {
  const [y, m] = iso.split('-').map(Number);
  const t = new Date(y, m - 1 + n, 1);
  const day = Math.min(anchor || +iso.slice(8, 10), daysIn(t.getFullYear(), t.getMonth()));
  return isoDate(new Date(t.getFullYear(), t.getMonth(), day));
}
const activeRems = () => Object.values(S.reminders).filter((r) => !r.done_at).sort((a, b) => a.due_date.localeCompare(b.due_date) || a.name.localeCompare(b.name));
const everyText = (r) => (r.kind === 'repeat' ? (r.every_months === 12 ? 'Every year' : r.every_months % 12 === 0 ? `Every ${r.every_months / 12} years` : r.every_months === 1 ? 'Every month' : `Every ${r.every_months} months`) : 'One-off');
function dueInfo(r) {
  const d = daysUntil(r.due_date);
  if (d < 0) return { cls: 'late', text: `${-d} day${d === -1 ? '' : 's'} overdue` };
  if (d === 0) return { cls: 'late', text: 'Due today' };
  if (d === 1) return { cls: 'soon', text: 'Due tomorrow' };
  if (d <= 30) return { cls: 'soon', text: `Due in ${d} days` };
  return { cls: 'later', text: shortDate(r.due_date) };
}
function remRow(r) {
  const done = !!r.done_at;
  const info = done ? { cls: 'later', text: 'Done ' + shortDate(isoDate(new Date(r.done_at))) } : dueInfo(r);
  const sub = [r.category_id ? catName(r.category_id) : '', everyText(r)].filter(Boolean).map(esc).join(' · ');
  const waiting = pendingIds().has(r.id);
  return `<button class="row${info.cls === 'late' && !done ? ' is-late' : ''}${done ? ' done-row' : ''}" data-rem="${esc(r.id)}">
    <div class="rem-icon ${done ? 'done' : info.cls}">${done ? I.check : r.kind === 'repeat' ? I.repeat : I.bell}</div>
    <div class="row-main"><div class="row-title">${esc(r.name)}</div><div class="row-sub"><span>${sub}</span></div></div>
    <div class="row-amt"><div class="due-txt ${info.cls}">${esc(info.text)}</div><div class="who">${waiting ? '<span class="tag-wait">Waiting</span>' : done ? '' : esc(info.cls === 'later' ? '' : shortDate(r.due_date))}</div></div>
  </button>`;
}
function dueStrip() {
  const due = activeRems().filter((r) => daysUntil(r.due_date) <= 30);
  if (!due.length) return '';
  const show = due.slice(0, 3);
  return `<div class="due-strip"><div class="strip-head"><span>Due soon</span><button data-allrem>${due.length > 3 ? `All ${due.length}` : 'Reminders'} ›</button></div>
    <div class="card">${show.map(remRow).join('')}</div></div>`;
}
function renderBadge() {
  const b = document.getElementById('remBadge');
  if (!b) return;
  const n = activeRems().filter((r) => daysUntil(r.due_date) <= 0).length;
  b.textContent = n; b.classList.toggle('hidden', !n);
}
function renderRems() {
  const el = document.getElementById('rem');
  if (!el) return;
  const all = Object.values(S.reminders);
  if (!all.length) {
    el.innerHTML = `<div class="empty"><h2>No reminders yet</h2>Tap <b>Add reminder</b> for things like insurance renewals, the MOT or a bike service.<br><br>You'll get a phone notification 30 days before and on the day.</div>`;
    return;
  }
  const act = activeRems();
  const late = act.filter((r) => daysUntil(r.due_date) < 0);
  const soon = act.filter((r) => { const d = daysUntil(r.due_date); return d >= 0 && d <= 30; });
  const later = act.filter((r) => daysUntil(r.due_date) > 30);
  const done = all.filter((r) => r.done_at).sort((a, b) => b.done_at - a.done_at);
  const sec = (title, list, cls = '') => (list.length ? `<div class="sec-title ${cls}"><span>${title}</span><span>${list.length}</span></div><div class="card">${list.map(remRow).join('')}</div>` : '');
  let html = '';
  if (!pref.get('pushAsked', '') && !pushOn()) {
    html += `<div class="note-box">Phone notifications are off on this phone. Turn them on in <b>Settings</b> to get a nudge 30 days before and on the day.</div>`;
  }
  html += sec('Overdue', late, 'late') + sec('Due in the next 30 days', soon) + sec('Later', later) + sec('Done', done);
  el.innerHTML = html;
}

function openRem(id) {
  const existing = id ? S.reminders[id] : null;
  if (id && !existing) return;
  const r = existing || { id: uid(), name: '', category_id: '', kind: 'repeat', due_date: '', every_months: 12, notes: '' };
  let kind = r.kind;
  const cats = sortedCats(false);
  if (r.category_id && S.cats[r.category_id] && S.cats[r.category_id].hidden) cats.push(S.cats[r.category_id]);
  const done = existing && existing.done_at;
  const meta = existing
    ? `Added by ${esc(existing.created_by || '?')}${existing.created_at ? ', ' + esc(fmtStamp(existing.created_at)) : ''}` +
      (existing.last_done_date ? `<br>Last done ${esc(shortDate(existing.last_done_date))}` : '') +
      (done ? `<br>Marked done by ${esc(existing.done_by || '?')}, ${esc(fmtStamp(existing.done_at))}` : '')
    : '';

  const sh = openSheet({
    title: existing ? 'Reminder' : 'New reminder',
    right: 'Save', onRight: () => save(),
    body: `
      <p class="form-error hidden" id="rErr"></p>
      <div class="group">
        <div class="field" id="rNameW"><label for="rName">What's it for?</label>
          <input id="rName" value="${esc(r.name)}" placeholder="e.g. River licence" autocomplete="off"></div>
        <div class="seg" id="rKind"><button data-k="repeat">Repeats</button><button data-k="once">One-off</button></div>
        <div class="field" id="rDueW"><label for="rDue" id="rDueL"></label>
          <input id="rDue" type="date" value="${esc(r.due_date)}"></div>
        <div class="field" id="rEveryW"><label for="rEvery">Repeat every</label>
          <div class="every"><input id="rEvery" inputmode="numeric" value="${esc(r.every_months || 12)}"><span>months</span></div></div>
        <p class="hint" id="rHint"></p>
      </div>
      <div class="group">
        <div class="field"><label for="rCat">Category</label>
          <select id="rCat"><option value="">None</option>
            ${cats.map((c) => `<option value="${esc(c.id)}" ${c.id === r.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select></div>
        <div class="field"><label for="rNotes">Notes</label>
          <textarea id="rNotes" placeholder="Optional, e.g. policy number or who to call">${esc(r.notes)}</textarea></div>
      </div>
      ${meta ? `<p class="meta-line">${meta}</p>` : ''}
      ${existing && !done ? `<button class="btn done-btn" id="rDone">Mark done</button>` : ''}
      ${done ? `<button class="btn plain" id="rUndone">Mark not done</button>` : ''}
      ${existing ? `<button class="btn danger" id="rDel">Delete reminder</button>` : `<button class="btn primary" id="rSave">Save reminder</button>`}`,
  });
  const $ = (s) => sh.querySelector(s);
  const drawKind = () => {
    sh.querySelectorAll('#rKind button').forEach((b) => b.classList.toggle('on', b.dataset.k === kind));
    $('#rEveryW').classList.toggle('hidden', kind !== 'repeat');
    $('#rDueL').textContent = kind === 'repeat' ? 'Next due' : 'Due date';
    $('#rHint').textContent = kind === 'repeat'
      ? 'Use 12 for yearly. Marking it done moves it on to the next date.'
      : 'Marking it done moves it to the Done list.';
  };
  $('#rKind').onclick = (e) => { const b = e.target.closest('[data-k]'); if (b) { kind = b.dataset.k; drawKind(); } };
  drawKind();
  if (!existing) setTimeout(() => $('#rName').focus(), 250);

  function fail(msg, w) {
    sh.querySelectorAll('.field.err').forEach((x) => x.classList.remove('err'));
    if (w) $(w).classList.add('err');
    const e = $('#rErr'); e.textContent = msg; e.classList.remove('hidden');
    sh.querySelector('.sheet-body').scrollTop = 0;
  }
  function read() {
    const name = $('#rName').value.trim();
    const due = $('#rDue').value;
    const every = parseInt($('#rEvery').value, 10);
    if (!name) { fail('Say what the reminder is for', '#rNameW'); return null; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) { fail('Choose the due date', '#rDueW'); return null; }
    if (kind === 'repeat' && !(every >= 1 && every <= 120)) { fail('Repeat every 1 to 120 months', '#rEveryW'); return null; }
    const anchor = existing && existing.due_date === due && existing.anchor_day ? existing.anchor_day : +due.slice(8, 10);
    return { name, kind, due_date: due, every_months: kind === 'repeat' ? every : null, anchor_day: anchor,
      category_id: $('#rCat').value || null, notes: $('#rNotes').value.trim(),
      last_done_date: (existing && existing.last_done_date) || null, done: kind === 'once' && !!done };
  }
  function put(rec, extra = {}) {
    const now = Date.now();
    S.reminders[r.id] = Object.assign({}, existing || { id: r.id, created_by: S.auth.user, created_at: now }, rec,
      { done_at: rec.done ? ((existing && existing.done_at) || now) : null, done_by: rec.done ? ((existing && existing.done_by) || S.auth.user) : null },
      existing ? { updated_by: S.auth.user, updated_at: now } : {}, extra);
    queue({ t: 'rem', id: r.id, rec });
    saveData();
  }
  function save() {
    const rec = read();
    if (!rec) return;
    put(rec);
    closeSheet(); renderList(); renderStatus();
    toast(navigator.onLine ? 'Saved' : 'Saved — will sync when you have signal');
    sync();
  }

  if (existing) {
    $('#rDel').onclick = async () => {
      if (!(await askConfirm('Delete this reminder?', `${r.name}. This removes it from the app.`, 'Delete', true))) return;
      const neverSent = !existing.seq;
      S.outbox = S.outbox.filter((o) => o.sending || o.id !== r.id);
      delete S.reminders[r.id];
      if (!neverSent) queue({ t: 'remdel', id: r.id }); else saveOutbox();
      saveData(); closeSheet(); renderList(); renderStatus();
      toast('Deleted');
      sync();
    };
  } else {
    $('#rSave').onclick = () => save();
  }
  if (existing && !done) {
    $('#rDone').onclick = async () => {
      const rec = read();
      if (!rec) return;
      const t = today();
      let msg;
      if (rec.kind === 'repeat') {
        let next = rec.due_date;
        do { next = addMonths(next, rec.every_months, rec.anchor_day); } while (next <= t);
        rec.due_date = next;
        rec.last_done_date = t;
        msg = `Done. Next due ${shortDate(next)}`;
      } else {
        rec.done = true;
        rec.last_done_date = t;
        msg = 'Done';
      }
      put(rec);
      closeSheet(); renderList(); renderStatus();
      toast(msg, 3200);
      sync();
      if (await askConfirm('Log the spend now?', `Add what “${rec.name}” cost to your spends.`, 'Log the spend')) {
        openEdit(null, { description: rec.name, category_id: rec.category_id && S.cats[rec.category_id] && !S.cats[rec.category_id].hidden ? rec.category_id : '' });
      }
    };
  }
  if (done) {
    $('#rUndone').onclick = () => {
      const rec = read();
      if (!rec) return;
      rec.done = false;
      put(rec);
      closeSheet(); renderList(); renderStatus();
      toast('Moved back to the list');
      sync();
    };
  }
}

// ---------------------------------------------------------------- regular payments
// Same date rules as the server: first date on or after the start; short months use their last day.
const FREQ_STEP = { month: 1, quarter: 3, year: 12 };
const FREQ_NAME = { month: 'Monthly', quarter: 'Quarterly', year: 'Yearly' };
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
function onDay(y, m, day) { const t = new Date(y, m - 1, 1); return isoDate(new Date(t.getFullYear(), t.getMonth(), Math.min(day, daysIn(t.getFullYear(), t.getMonth())))); }
function regularDates(g, upto, limit = 1200) {
  const step = FREQ_STEP[g.freq];
  if (!step || !g.start_date) return [];
  let y = +g.start_date.slice(0, 4), m = g.freq === 'year' ? g.month : +g.start_date.slice(5, 7);
  if (onDay(y, m, g.day) < g.start_date) { if (g.freq === 'year') y += 1; else m += 1; }
  const out = [];
  for (let k = 0; k < limit; k++) {
    if (g.end_kind === 'count' && k >= g.end_count) break;
    const d = onDay(y, m + k * step, g.day);
    if (upto && d > upto) break;
    if (g.end_kind === 'date' && g.end_date && d > g.end_date) break;
    out.push(d);
  }
  return out;
}
const nextRegular = (g) => (g.stopped_at ? null : regularDates(g, null, 1200).find((d) => d > today()) || null);
const amountOn = (amounts, date) => { let p = amounts.length ? amounts[0].pence : 0; amounts.forEach((a) => { if (a.from <= date) p = a.pence; }); return p; };
const currentAmount = (g) => amountOn(g.amounts || [], nextRegular(g) || today());
function scheduleText(g) {
  const when = g.freq === 'year' ? `on ${g.day} ${MONTH_NAMES[g.month - 1]}` : `on the ${ordinal(g.day)}`;
  return `${FREQ_NAME[g.freq]} ${when}`;
}
function endText(g) {
  if (g.end_kind === 'date') return 'until ' + shortDate(g.end_date);
  if (g.end_kind === 'count') return `${g.end_count} payment${g.end_count === 1 ? '' : 's'}`;
  return 'until stopped';
}
const regSpends = (gid) => Object.values(S.spends).filter((s) => s.regular_id === gid);

function bindRegGroup() {
  const box = document.getElementById('stRegGroup');
  if (!box) return;
  box.querySelectorAll('[data-reg]').forEach((b) => { b.onclick = () => openRegular(b.dataset.reg); });
  const add = box.querySelector('#stRegAdd');
  if (add) add.onclick = () => openRegular(null);
}
// Keep the Settings list current while it's open (payments arrive after a sync).
function refreshRegGroup() {
  const box = document.getElementById('stRegGroup');
  if (!box) return;
  box.innerHTML = regularsGroup();
  bindRegGroup();
}
function regularsGroup() {
  const list = Object.values(S.regulars).sort((a, b) => !!a.stopped_at - !!b.stopped_at || a.description.localeCompare(b.description));
  const rows = list.map((g) => {
    const next = nextRegular(g);
    const n = regSpends(g.id).length;
    const sub = g.stopped_at ? `Stopped · ${n} added` : `${scheduleText(g)} · ${next ? 'next ' + shortDate(next) : 'finished'} · ${n} added`;
    return `<button class="list-item" data-reg="${esc(g.id)}" style="width:100%;border:0;background:transparent;text-align:left">
      <div class="li-main" style="${g.stopped_at ? 'color:var(--faint)' : ''}">${esc(g.description)}<small>${esc(sub)}</small></div>
      <span class="num" style="font-weight:600;${g.stopped_at ? 'color:var(--faint)' : ''}">${money(currentAmount(g))}</span><span style="color:var(--faint)">›</span></button>`;
  }).join('');
  return rows + `<div class="list-item"><div class="li-main">${list.length ? 'Add another' : 'Mortgage, insurance, subscriptions and so on'}<small>Added to your spends automatically on the day</small></div><button class="mini" id="stRegAdd">Add</button></div>`;
}

function openRegular(id) {
  const existing = id ? S.regulars[id] : null;
  if (id && !existing) return;
  const g = existing ? JSON.parse(JSON.stringify(existing)) : {
    id: uid(), description: '', supplier: '', category_id: S.cats['cat-mortgage'] && !S.cats['cat-mortgage'].hidden ? 'cat-mortgage' : '', account: 'debit', notes: '',
    freq: 'month', day: new Date().getDate(), month: new Date().getMonth() + 1, start_date: today(), end_kind: 'never', end_date: '', end_count: 12, amounts: [],
  };
  let freq = g.freq, endKind = g.end_kind, account = g.account || '';
  const stopped = existing && existing.stopped_at;
  const cats = sortedCats(false);
  if (g.category_id && S.cats[g.category_id] && S.cats[g.category_id].hidden) cats.push(S.cats[g.category_id]);
  const amountRows = () => (g.amounts || []).map((a, i, arr) => `<div class="list-item"><div class="li-main">${money(a.pence)}<small>${i === 0 ? 'From the start' : 'From ' + esc(shortDate(a.from))}${i < arr.length - 1 ? ' until ' + esc(shortDate(arr[i + 1].from)) : ''}</small></div></div>`).join('');
  const n = existing ? regSpends(g.id).length : 0;
  const meta = existing
    ? `Set up by ${esc(existing.created_by || '?')}${existing.created_at ? ', ' + esc(fmtStamp(existing.created_at)) : ''} · ${n} payment${n === 1 ? '' : 's'} added so far` +
      (stopped ? `<br>Stopped by ${esc(existing.stopped_by || '?')}, ${esc(fmtStamp(existing.stopped_at))}` : '')
    : '';

  const sh = openSheet({
    title: existing ? 'Regular payment' : 'New regular payment',
    left: '‹ Back', onLeft: openSettings,
    right: stopped ? '' : 'Save', onRight: () => save(),
    body: `
      <p class="form-error hidden" id="gErr"></p>
      <div class="group">
        <div class="field" id="gDescW"><label for="gDesc">What is it?</label>
          <input id="gDesc" value="${esc(g.description)}" placeholder="e.g. Mortgage" autocomplete="off" ${stopped ? 'disabled' : ''}></div>
        ${existing ? '' : `<div class="field" id="gAmtW"><label for="gAmt">Amount each time</label>
          <div class="money"><span>£</span><input id="gAmt" inputmode="decimal" placeholder="0.00" autocomplete="off"></div></div>`}
        <div class="field"><label for="gSup">Supplier</label><input id="gSup" value="${esc(g.supplier)}" placeholder="Optional" autocomplete="off" ${stopped ? 'disabled' : ''}></div>
        <div class="field"><label for="gCat">Category</label>
          <select id="gCat" ${stopped ? 'disabled' : ''}><option value="">None</option>
            ${cats.map((c) => `<option value="${esc(c.id)}" ${c.id === g.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      </div>
      <div class="group-title">Paid with</div>
      <div class="group">${acctSeg('gAcct', account, stopped)}</div>
      ${existing ? `
      <div class="group-title">Amount</div>
      <div class="group">${amountRows()}
        ${stopped ? '' : `<div id="gChangeW" class="hidden">
          <div class="field" id="gNewAmtW"><label for="gNewAmt">New amount</label><div class="money"><span>£</span><input id="gNewAmt" inputmode="decimal" placeholder="0.00" autocomplete="off"></div></div>
          <div class="field" id="gFromW"><label for="gFrom">From</label><input id="gFrom" type="date" value="${esc(nextRegular(g) || today())}"></div>
          <p class="hint">Payments from this date use the new amount, including any already added. Earlier ones keep the old amount. Payments you've edited by hand aren't changed.</p>
        </div>
        <div class="list-item"><div class="li-main"></div><button class="mini" id="gChange">Change amount</button></div>`}
      </div>
      <div class="group-title">Schedule</div>
      <div class="group">
        <div class="list-item"><div class="li-main">${esc(scheduleText(g))}<small>First payment ${esc(shortDate(regularDates(g, null, 1)[0] || g.start_date))}${nextRegular(g) ? ' · next ' + esc(shortDate(nextRegular(g))) : ''}</small></div></div>
        <p class="hint">To change how often or the day, stop this one and add a new one.</p>
      </div>` : `
      <div class="group-title">Schedule</div>
      <div class="group">
        <div class="seg" id="gFreq"><button data-f="month">Monthly</button><button data-f="quarter">Quarterly</button><button data-f="year">Yearly</button></div>
        <div class="field" id="gDayW"><label for="gDay">Day of the month</label><div class="every"><input id="gDay" inputmode="numeric" value="${esc(g.day)}"><span id="gDayTxt"></span></div></div>
        <div class="field" id="gMonthW"><label for="gMonth">Month</label><select id="gMonth">${MONTH_NAMES.map((mn, i) => `<option value="${i + 1}" ${i + 1 === g.month ? 'selected' : ''}>${mn}</option>`).join('')}</select></div>
        <div class="field" id="gStartW"><label for="gStart">Starting from</label><input id="gStart" type="date" value="${esc(g.start_date)}"></div>
        <p class="hint" id="gPreview"></p>
      </div>`}
      <div class="group-title">Ends</div>
      <div class="group">
        <div class="seg" id="gEnd"><button data-e="never">Ongoing</button><button data-e="date">On a date</button><button data-e="count">After…</button></div>
        <div class="field" id="gEndDateW"><label for="gEndDate">Last payment on or before</label><input id="gEndDate" type="date" value="${esc(g.end_date || '')}" ${stopped ? 'disabled' : ''}></div>
        <div class="field" id="gCountW"><label for="gCount">Number of payments</label><div class="every"><input id="gCount" inputmode="numeric" value="${esc(g.end_count || 12)}" ${stopped ? 'disabled' : ''}><span>payments</span></div></div>
      </div>
      <div class="group">
        <div class="field"><label for="gNotes">Notes</label><textarea id="gNotes" placeholder="Optional — copied onto each payment" ${stopped ? 'disabled' : ''}>${esc(g.notes)}</textarea></div>
      </div>
      ${meta ? `<p class="meta-line">${meta}</p>` : ''}
      ${!existing ? `<button class="btn primary" id="gSave">Save regular payment</button>` : ''}
      ${existing && !stopped ? `<button class="btn plain" id="gStop">Stop payments</button>` : ''}
      ${existing ? `<button class="btn danger" id="gDel">Delete regular payment</button>` : ''}
      ${existing ? `<p class="meta-line">Stopping or deleting never removes payments already added.</p>` : ''}`,
  });
  const $ = (q) => sh.querySelector(q);

  bindAcctSeg(sh, 'gAcct', (a) => { account = a; });
  const readSchedule = () => existing ? g : {
    freq, day: parseInt($('#gDay').value, 10), month: +$('#gMonth').value, start_date: $('#gStart').value,
    end_kind: endKind, end_date: $('#gEndDate').value, end_count: parseInt($('#gCount').value, 10),
  };
  const drawPreview = () => {
    if (existing) return;
    const sc = readSchedule();
    $('#gMonthW').classList.toggle('hidden', freq !== 'year');
    $('#gDayW label').textContent = freq === 'year' ? 'Day' : 'Day of the month';
    $('#gDayTxt').textContent = sc.day >= 29 && sc.day <= 31 && freq !== 'year' ? 'Short months use their last day' : '';
    if (!(sc.day >= 1 && sc.day <= 31) || !sc.start_date) { $('#gPreview').textContent = ''; return; }
    const first = regularDates(sc, null, 1)[0];
    const now = regularDates(sc, today()).length;
    $('#gPreview').textContent = first
      ? `First payment ${shortDate(first)}.` + (now ? ` ${now} payment${now === 1 ? '' : 's'} up to today will be added when you save.` : ' Nothing to add yet.')
      : 'No payments fall within these dates.';
  };
  const drawSeg = () => {
    if (!existing) sh.querySelectorAll('#gFreq button').forEach((b) => b.classList.toggle('on', b.dataset.f === freq));
    sh.querySelectorAll('#gEnd button').forEach((b) => { b.classList.toggle('on', b.dataset.e === endKind); b.disabled = !!stopped; });
    $('#gEndDateW').classList.toggle('hidden', endKind !== 'date');
    $('#gCountW').classList.toggle('hidden', endKind !== 'count');
    drawPreview();
  };
  if (!existing) {
    $('#gFreq').onclick = (e) => { const b = e.target.closest('[data-f]'); if (b) { freq = b.dataset.f; drawSeg(); } };
    ['#gDay', '#gMonth', '#gStart'].forEach((q) => $(q).addEventListener('input', drawPreview));
    setTimeout(() => $('#gDesc').focus(), 250);
  }
  $('#gEnd').onclick = (e) => { const b = e.target.closest('[data-e]'); if (b && !stopped) { endKind = b.dataset.e; drawSeg(); } };
  ['#gEndDate', '#gCount'].forEach((q) => $(q).addEventListener('input', drawPreview));
  drawSeg();
  if (existing && !stopped) $('#gChange').onclick = () => { $('#gChangeW').classList.remove('hidden'); $('#gChange').closest('.list-item').classList.add('hidden'); setTimeout(() => $('#gNewAmt').focus(), 50); };

  function fail(msg, w) {
    sh.querySelectorAll('.field.err').forEach((x) => x.classList.remove('err'));
    if (w) $(w).classList.add('err');
    const e = $('#gErr'); e.textContent = msg; e.classList.remove('hidden');
    sh.querySelector('.sheet-body').scrollTop = 0;
  }
  function build(extra = {}) {
    const description = $('#gDesc').value.trim();
    if (!description) return fail('Say what the payment is', '#gDescW');
    const sc = readSchedule();
    let amounts = (g.amounts || []).slice();
    if (!existing) {
      const p = parseMoney($('#gAmt').value);
      if (p == null) return fail('Enter the amount, e.g. 350.00', '#gAmtW');
      if (!(sc.day >= 1 && sc.day <= 31)) return fail('Day must be 1 to 31', '#gDayW');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(sc.start_date)) return fail('Choose the start date', '#gStartW');
      amounts = [{ from: sc.start_date, pence: p }];
    } else if (!$('#gChangeW') || $('#gChangeW').classList.contains('hidden') || !$('#gNewAmt').value.trim()) {
      // no amount change
    } else {
      const p = parseMoney($('#gNewAmt').value);
      const from = $('#gFrom').value;
      if (p == null) return fail('Enter the new amount', '#gNewAmtW');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return fail('Choose when the new amount starts', '#gFromW');
      amounts = amounts.filter((a) => a.from !== from).concat({ from, pence: p }).sort((a, b) => a.from.localeCompare(b.from));
    }
    const ek = endKind;
    const endDate = $('#gEndDate').value, endCount = parseInt($('#gCount').value, 10);
    if (ek === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < sc.start_date)) return fail('The end date must be after the start', '#gEndDateW');
    if (ek === 'count' && !(endCount >= 1 && endCount <= 1200)) return fail('Number of payments must be 1 to 1200', '#gCountW');
    return Object.assign({
      description, supplier: $('#gSup').value.trim(), category_id: $('#gCat').value || null, account: account || null, notes: $('#gNotes').value.trim(),
      freq: sc.freq, day: sc.day, month: sc.freq === 'year' ? sc.month : null, start_date: sc.start_date,
      end_kind: ek, end_date: ek === 'date' ? endDate : null, end_count: ek === 'count' ? endCount : null,
      amounts, stopped: !!stopped,
    }, extra);
  }
  function put(rec) {
    const now = Date.now();
    const { stopped: st, ...fields } = rec;
    S.regulars[g.id] = Object.assign({}, existing || { id: g.id, created_by: S.auth.user, created_at: now }, fields,
      { stopped_at: st ? ((existing && existing.stopped_at) || now) : null, stopped_by: st ? ((existing && existing.stopped_by) || S.auth.user) : null },
      existing ? { updated_by: S.auth.user, updated_at: now } : {});
    queue({ t: 'reg', id: g.id, rec });
    saveData();
  }
  function save() {
    const rec = build();
    if (!rec) return;
    put(rec);
    openSettings(); renderList(); renderStatus();
    const due = existing ? 0 : regularDates(rec, today()).length;
    toast(!navigator.onLine ? 'Saved — payments will be added when you have signal' : due ? `Saved — adding ${due} payment${due === 1 ? '' : 's'}` : 'Saved', 3200);
    sync();
  }
  if (!existing) $('#gSave').onclick = save;
  if (existing && !stopped) $('#gStop').onclick = async () => {
    if (!(await askConfirm('Stop this regular payment?', `${g.description}: no more payments will be added. The ${n} already added stay.`, 'Stop payments', true))) return;
    const rec = build({ stopped: true });
    if (!rec) return;
    put(rec); openSettings(); renderList(); renderStatus(); toast('Stopped'); sync();
  };
  if (existing) $('#gDel').onclick = async () => {
    if (!(await askConfirm('Delete this regular payment?', `${g.description}: it's removed from the list and no more payments are added. The ${n} already added stay in your spends.`, 'Delete', true))) return;
    const neverSent = !existing.seq;
    S.outbox = S.outbox.filter((o) => o.sending || o.id !== g.id);
    delete S.regulars[g.id];
    if (!neverSent) queue({ t: 'regdel', id: g.id }); else saveOutbox();
    saveData(); openSettings(); renderList(); renderStatus(); toast('Deleted'); sync();
  };
}

// ---------------------------------------------------------------- notifications + calendar
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const pushOn = () => pushSupported() && Notification.permission === 'granted' && pref.get('pushOn', '') === '1';
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
function keyBytes(b64u) {
  const s = b64u.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64u.length + 3) % 4);
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
async function currentSub() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}
async function turnOnPush() {
  pref.set('pushAsked', '1');
  const perm = await Notification.requestPermission(); // first, while the tap still counts
  if (perm !== 'granted') {
    throw new Error(perm === 'denied'
      ? 'Notifications are blocked for Life Costs. Allow them in the iPhone Settings app under Notifications → Life Costs.'
      : 'Notifications were not allowed.');
  }
  const { key } = await api('GET', '/push/key');
  if (!key) throw new Error('The server is not set up for notifications yet');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && pref.get('pushKey', '') !== key) { await sub.unsubscribe().catch(() => {}); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await api('POST', '/push/subscribe', sub.toJSON());
  pref.set('pushKey', key); pref.set('pushOn', '1');
}
async function turnOffPush() {
  const sub = await currentSub();
  if (sub) { await api('DELETE', '/push/subscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
  pref.set('pushOn', '');
}
// Re-send this phone's subscription once a session, in case the server dropped it.
let pushRefreshed = false;
async function refreshPush() {
  if (pushRefreshed || !pushOn()) return;
  try {
    const sub = await currentSub();
    if (!sub) { pref.set('pushOn', ''); return; }
    await api('POST', '/push/subscribe', sub.toJSON());
    pushRefreshed = true;
  } catch {}
}

function notifyGroup() {
  if (!pushSupported()) {
    const msg = isIOS() && !isStandalone()
      ? 'Open Life Costs from its home-screen icon to turn notifications on.'
      : 'This phone or browser can’t show notifications from Life Costs. iPhones need iOS 16.4 or later, opened from the home-screen icon.';
    return `<div class="list-item"><div class="li-main">Off<small>${esc(msg)}</small></div></div>`;
  }
  if (pushOn()) {
    return `<div class="list-item"><div class="li-main">On for this phone<small>30 days before and on the due date, at 9am</small></div><button class="mini" id="stTest">Send test</button></div>
      <div class="list-item"><div class="li-main">Turn off on this phone</div><button class="mini muted" id="stPushOff">Turn off</button></div>`;
  }
  const blocked = Notification.permission === 'denied';
  return `<div class="list-item"><div class="li-main">Off<small>${blocked ? 'Blocked — allow them in the iPhone Settings app under Notifications → Life Costs' : 'Get a nudge 30 days before and on the due date, at 9am'}</small></div>${blocked ? '' : '<button class="mini" id="stPushOn">Turn on</button>'}</div>`;
}

async function openCalendar() {
  try {
    const { url } = await api('GET', '/calendar-link');
    const webcal = url.replace(/^https?:/, 'webcal:');
    pref.set('calUrl', url);
    location.href = webcal;
  } catch (e) {
    toast(e.network ? 'Needs signal to set up the calendar' : e.message, 3500);
  }
}
async function copyCalendar() {
  try {
    const url = pref.get('calUrl', '') || (await api('GET', '/calendar-link')).url;
    pref.set('calUrl', url);
    await navigator.clipboard.writeText(url);
    toast('Calendar link copied');
  } catch (e) { toast(e.network ? 'Needs signal' : 'Could not copy the link'); }
}

// ---------------------------------------------------------------- filter sheet
function openFilter() {
  const f = Object.assign({}, S.filter);
  const y = new Date().getFullYear();
  const t = today();
  const yearAgo = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); d.setDate(d.getDate() + 1); return isoDate(d); })();
  const quick = [
    ['This year', `${y}-01-01`, ''],
    ['Last year', `${y - 1}-01-01`, `${y - 1}-12-31`],
    ['Last 12 months', yearAgo, ''],
    ['All time', '', ''],
  ];
  const sh = openSheet({
    title: 'Filter', right: 'Done',
    onRight: () => apply(),
    body: `
      <div class="group-title">Dates</div>
      <div class="group">
        <div class="quick" id="quick">${quick.map(([l, a, b], i) => `<button data-q="${i}" class="${f.from === a && f.to === b && (a || b || (!f.from && !f.to)) ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="field"><label for="ffFrom">From</label><input type="date" id="ffFrom" value="${esc(f.from)}"></div>
        <div class="field"><label for="ffTo">To</label><input type="date" id="ffTo" value="${esc(f.to)}" max="${t}"></div>
      </div>
      <div class="group-title">Category</div>
      <div class="group">
        <div class="field"><select id="ffCat"><option value="">All categories</option>
          ${sortedCats(true).map((c) => `<option value="${esc(c.id)}" ${c.id === f.cat ? 'selected' : ''}>${esc(c.name)}${c.hidden ? ' (hidden)' : ''}</option>`).join('')}
          <option value="__none" ${f.cat === '__none' ? 'selected' : ''}>No category</option>
        </select></div>
      </div>
      <div class="group-title">Paid with</div>
      <div class="group">
        <div class="field"><select id="ffAcct"><option value="">All accounts</option>
          ${ACCOUNTS.map(([k, l]) => `<option value="${k}" ${k === f.acct ? 'selected' : ''}>${l}</option>`).join('')}
          <option value="__none" ${f.acct === '__none' ? 'selected' : ''}>Not set</option>
        </select></div>
      </div>
      <div class="group">
        <label class="toggle"><span class="t-text">Only estimated costs<small>Find guesses to firm up later</small></span>
          <span class="switch"><input type="checkbox" id="ffEst" ${f.est ? 'checked' : ''}><span></span></span></label>
      </div>
      <button class="btn primary" id="ffApply">Show results</button>
      <button class="btn plain" id="ffClear">Clear filters</button>`,
  });
  const $ = (s) => sh.querySelector(s);
  $('#quick').onclick = (e) => {
    const b = e.target.closest('[data-q]'); if (!b) return;
    const [, a, z] = quick[+b.dataset.q];
    $('#ffFrom').value = a; $('#ffTo').value = z;
    sh.querySelectorAll('#quick button').forEach((x) => x.classList.toggle('on', x === b));
  };
  ['#ffFrom', '#ffTo'].forEach((s) => $(s).addEventListener('change', () => sh.querySelectorAll('#quick button').forEach((x) => x.classList.remove('on'))));
  function apply() {
    let from = $('#ffFrom').value, to = $('#ffTo').value;
    if (from && to && from > to) [from, to] = [to, from];
    Object.assign(S.filter, { from, to, cat: $('#ffCat').value, est: $('#ffEst').checked, acct: $('#ffAcct').value });
    closeSheet(); renderList();
  }
  $('#ffApply').onclick = apply;
  $('#ffClear').onclick = () => { Object.assign(S.filter, { from: '', to: '', cat: '', est: false, acct: '' }); closeSheet(); renderList(); };
}

// ---------------------------------------------------------------- settings + categories
function openSettings() {
  const s = statusText();
  const sh = openSheet({
    title: 'Settings', left: 'Close',
    body: `
      <div class="group-title">Signed in</div>
      <div class="group">
        <div class="list-item"><div class="li-main">${esc(S.auth.user)}<small>The app locks after 5 minutes in the background</small></div><button class="mini" id="stLock">Lock now</button></div>
      </div>
      <div class="group-title">Sync</div>
      <div class="group">
        <div class="list-item"><div class="li-main">${esc(s.long)}<small>${S.sync.last ? 'Last synced ' + esc(fmtStamp(S.sync.last)) : 'Not synced yet this session'}</small></div><button class="mini" id="stSync">Sync now</button></div>
      </div>
      <div class="group-title">Regular payments</div>
      <div class="group" id="stRegGroup">${regularsGroup()}</div>
      ${FEATURES.rem ? `<div class="group-title">Reminder notifications</div>
      <div class="group">${notifyGroup()}</div>` : ''}
      <div class="group-title">Categories</div>
      <div class="group">
        <button class="list-item" id="stCats" style="width:100%;border:0;background:transparent;text-align:left"><div class="li-main">Manage categories<small>Add your own, rename or hide</small></div><span style="color:var(--faint)">›</span></button>
      </div>
      <button class="btn danger" id="stOut">Sign out of this device</button>
      <p class="meta-line" style="margin-top:18px">Life Costs ${VERSION}</p>`,
  });
  const $s = (q) => sh.querySelector(q);
  if ($s('#stPushOn')) $s('#stPushOn').onclick = (e) => {
    e.target.disabled = true; e.target.textContent = 'Asking…';
    turnOnPush().then(() => { toast('Notifications are on for this phone'); openSettings(); renderList(); })
      .catch((err) => { toast(err.network ? 'Needs signal to turn on' : err.message, 5000); openSettings(); });
  };
  if ($s('#stPushOff')) $s('#stPushOff').onclick = () => turnOffPush().then(() => { toast('Notifications off for this phone'); openSettings(); renderList(); });
  if ($s('#stTest')) $s('#stTest').onclick = async (e) => {
    e.target.disabled = true;
    try { const sub = await currentSub(); await api('POST', '/push/test', { endpoint: sub && sub.endpoint }); toast('Sent — it should arrive in a few seconds'); }
    catch (err) { toast(err.network ? 'Needs signal' : err.message, 5000); if (err.status === 404 || err.status === 502) { pref.set('pushOn', ''); openSettings(); } }
    e.target.disabled = false;
  };
  bindRegGroup();
  sh.querySelector('#stLock').onclick = lockNow;
  sh.querySelector('#stSync').onclick = () => sync().then(openSettings);
  sh.querySelector('#stCats').onclick = openCategories;
  sh.querySelector('#stOut').onclick = signOut;
}

function openCategories() {
  const counts = {};
  Object.values(S.spends).forEach((x) => { counts[x.category_id] = (counts[x.category_id] || 0) + 1; });
  const cats = sortedCats(true);
  const sh = openSheet({
    title: 'Categories', left: '‹ Back', onLeft: openSettings,
    body: `
      <div class="group">
        ${cats.map((c) => `<div class="list-item" data-cat="${esc(c.id)}">
          <input type="text" value="${esc(c.name)}" aria-label="Category name" style="${c.hidden ? 'color:var(--faint)' : ''}">
          <small style="color:var(--muted);white-space:nowrap">${counts[c.id] || 0}</small>
          <button class="mini ${c.hidden ? '' : 'muted'}" data-tog>${c.hidden ? 'Show' : 'Hide'}</button></div>`).join('')}
      </div>
      <div class="group-title">Add a category</div>
      <div class="group"><div class="list-item"><input type="text" id="newCat" placeholder="e.g. Dog" autocomplete="off"><button class="mini" id="addCat">Add</button></div></div>
      <p class="meta-line">Tap a name to rename it. Hidden categories stay on old spends but don't appear when adding new ones. The number is how many spends use it.</p>`,
  });
  const put = (c) => { S.cats[c.id] = c; queue({ t: 'cat', id: c.id, rec: { name: c.name, sort: c.sort, hidden: c.hidden } }); saveData(); renderList(); renderStatus(); sync(); };
  sh.querySelectorAll('[data-cat]').forEach((row) => {
    const c = S.cats[row.dataset.cat];
    const inp = row.querySelector('input');
    inp.addEventListener('change', () => {
      const name = inp.value.trim();
      if (!name) { inp.value = c.name; return; }
      if (name !== c.name) { put(Object.assign({}, c, { name })); toast('Renamed'); }
    });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    row.querySelector('[data-tog]').onclick = () => { put(Object.assign({}, S.cats[c.id], { hidden: S.cats[c.id].hidden ? 0 : 1 })); openCategories(); };
  });
  const add = () => {
    const inp = sh.querySelector('#newCat');
    const name = inp.value.trim();
    if (!name) return;
    if (Object.values(S.cats).some((c) => c.name.toLowerCase() === name.toLowerCase())) { toast('That category already exists'); return; }
    const sort = Math.max(0, ...Object.values(S.cats).map((c) => c.sort || 0)) + 10;
    put({ id: 'cat-' + uid().slice(0, 12), name, sort, hidden: 0 });
    openCategories();
  };
  sh.querySelector('#addCat').onclick = add;
  sh.querySelector('#newCat').addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
}

// ---------------------------------------------------------------- lifecycle
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { S.hiddenAt = Date.now(); return; }
  if (S.unlocked && S.hiddenAt && Date.now() - S.hiddenAt > LOCK_AFTER_MS) { showLock('unlock'); return; }
  if (S.unlocked) sync();
});
window.addEventListener('online', () => { S.sync.offline = false; if (S.unlocked) sync(); });
window.addEventListener('offline', () => { S.sync.offline = true; renderStatus(); });
setInterval(() => { if (S.unlocked && document.visibilityState === 'visible') sync(); }, POLL_MS);

// A tapped notification brings the app forward on the Reminders tab.
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => {
  if (e.data && e.data.open === 'reminders') { if (document.querySelector('.top')) setView('rem'); else { S.view = 'rem'; pref.set('view', 'rem'); } }
});

async function start() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
  await loadLocal();
  const v = pref.get('view', 'list');
  S.view = (v === 'dash' && FEATURES.dash) || (v === 'rem' && FEATURES.rem) ? v : 'list';
  if (location.hash === '#reminders' && FEATURES.rem) { S.view = 'rem'; history.replaceState(null, '', location.pathname + location.search); }
  S.auth = readAuth();
  if (S.auth && S.auth.token && S.auth.hash) showLock('unlock');
  else showLock('signin', S.auth ? 'Please sign in again with your passcode.' : '');
}

// test hook (harmless in production)
window.__life = { S, sync };
start();
})();
