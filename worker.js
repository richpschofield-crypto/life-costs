// Life Costs — Cloudflare Worker + D1
// Serves the phone app itself and its sync API from one address.
// Passcode sign-in, spends (with the account paid from), categories, receipt
// photos and PDFs, sync, and regular payments (spends added automatically on a
// schedule). Reminder notifications are built in but switched off in the app
// until stage 4.
//
// Needs (Worker > Settings):
//   Binding   DB            -> D1 database "life-costs"
//   Secret    PASSCODES     -> e.g.  Richard:123456
//   Secret    TOKEN_SECRET  -> any long random string
//   Secret    VAPID_PUBLIC / VAPID_PRIVATE -> only needed for stage 4 notifications
//   Trigger   Cron "0 * * * *" (every hour: regular payments are added once their day arrives)
//
// The database tables are created automatically on first use.

// The app's own files live in the GitHub repo richpschofield-crypto/life-costs
// (folder public/) and are served from here, so the app and its server share
// one address. Pushing to the repo updates the app within about five minutes.
const RAW = 'https://raw.githubusercontent.com/richpschofield-crypto/life-costs/main/public/';
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  '/icon-192.png': ['icon-192.png', 'image/png'],
  '/icon-512.png': ['icon-512.png', 'image/png'],
  '/apple-touch-icon.png': ['apple-touch-icon.png', 'image/png'],
};
async function serveStatic(path) {
  const f = STATIC[path];
  if (!f) return null;
  const res = await fetch(RAW + f[0], { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!res.ok) {
    return new Response(path === '/' ? '<!doctype html><meta name="viewport" content="width=device-width"><title>Life Costs</title><p style="font:17px system-ui;padding:24px">Life Costs is being set up. Try again in a few minutes.</p>' : 'Not found',
      { status: res.status === 404 ? 404 : 502, headers: { 'Content-Type': path === '/' ? 'text/html; charset=utf-8' : 'text/plain' } });
  }
  return new Response(res.body, {
    headers: {
      'Content-Type': f[1],
      'Cache-Control': path === '/sw.js' ? 'no-cache' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

const APP_NAME = 'Life Costs';
const TOKEN_DAYS = 400;
const MAX_FILE_BYTES = 5_000_000;      // photos and PDFs, stored in chunks
const CHUNK_BYTES = 700_000;           // each chunk stays well under D1's 2 MB row limit after base64
const LOGIN_MAX_FAILS = 10;            // per IP ...
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // ... per 15 minutes
const ACCOUNTS = ['debit', 'credit', 'cash'];

const DEFAULT_CATEGORIES = [
  ['cat-mortgage', 'Mortgage'],
  ['cat-utilities', 'Utilities'],
  ['cat-phone', 'Phone & internet'],
  ['cat-insurance', 'Insurance'],
  ['cat-garage', 'Garage'],
  ['cat-fuel', 'Fuel'],
  ['cat-car', 'Car expenses'],
  ['cat-bike', 'Bike expenses'],
  ['cat-boat', 'Boat'],
  ['cat-groceries', 'Groceries'],
  ['cat-eating', 'Eating out'],
  ['cat-subs', 'Subscriptions'],
  ['cat-shopping', 'Shopping'],
  ['cat-health', 'Health'],
  ['cat-gifts', 'Gifts'],
  ['cat-holidays', 'Holidays'],
  ['cat-cash', 'Cash'],
  ['cat-other', 'Other'],
];

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS categories (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0,
     hidden INTEGER NOT NULL DEFAULT 0, updated_by TEXT, updated_at INTEGER,
     seq INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS spends (
     id TEXT PRIMARY KEY, date TEXT NOT NULL, description TEXT NOT NULL,
     supplier TEXT NOT NULL DEFAULT '', amount_pence INTEGER NOT NULL,
     category_id TEXT, account TEXT, notes TEXT NOT NULL DEFAULT '', estimated INTEGER NOT NULL DEFAULT 0,
     created_by TEXT, created_at INTEGER, updated_by TEXT, updated_at INTEGER,
     deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL,
     regular_id TEXT, regular_date TEXT, manual INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS spends_seq ON spends(seq)`,
  `CREATE INDEX IF NOT EXISTS spends_regular ON spends(regular_id)`,
  `CREATE TABLE IF NOT EXISTS photos (
     id TEXT PRIMARY KEY, spend_id TEXT NOT NULL, mime TEXT, data TEXT, size INTEGER,
     created_by TEXT, created_at INTEGER, deleted INTEGER NOT NULL DEFAULT 0,
     seq INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS photos_seq ON photos(seq)`,
  `CREATE INDEX IF NOT EXISTS photos_spend ON photos(spend_id)`,
  `CREATE INDEX IF NOT EXISTS categories_seq ON categories(seq)`,
  `CREATE TABLE IF NOT EXISTS file_chunks (photo_id TEXT NOT NULL, idx INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (photo_id, idx))`,
  `CREATE TABLE IF NOT EXISTS login_fail (ip TEXT NOT NULL, ts INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS reminders (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, category_id TEXT,
     kind TEXT NOT NULL DEFAULT 'once', due_date TEXT NOT NULL,
     every_months INTEGER, anchor_day INTEGER, notes TEXT NOT NULL DEFAULT '',
     done_at INTEGER, done_by TEXT, last_done_date TEXT,
     created_by TEXT, created_at INTEGER, updated_by TEXT, updated_at INTEGER,
     deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS reminders_seq ON reminders(seq)`,
  `CREATE TABLE IF NOT EXISTS push_subs (
     endpoint TEXT PRIMARY KEY, user TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
     created_at INTEGER, last_ok INTEGER)`,
  `CREATE TABLE IF NOT EXISTS notes_sent (
     reminder_id TEXT NOT NULL, due_date TEXT NOT NULL, kind TEXT NOT NULL, sent_at INTEGER,
     PRIMARY KEY (reminder_id, due_date, kind))`,
  `CREATE TABLE IF NOT EXISTS regulars (
     id TEXT PRIMARY KEY, description TEXT NOT NULL, supplier TEXT NOT NULL DEFAULT '',
     category_id TEXT, account TEXT, notes TEXT NOT NULL DEFAULT '',
     freq TEXT NOT NULL, day INTEGER NOT NULL, month INTEGER, start_date TEXT NOT NULL,
     end_kind TEXT NOT NULL DEFAULT 'never', end_date TEXT, end_count INTEGER,
     amounts TEXT NOT NULL, stopped_at INTEGER, stopped_by TEXT,
     created_by TEXT, created_at INTEGER, updated_by TEXT, updated_at INTEGER,
     deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS regulars_seq ON regulars(seq)`,
  `INSERT OR IGNORE INTO meta (k, v) VALUES ('seq', 100)`,
];

let schemaReady = null;
function ensureSchema(env) {
  if (!schemaReady) {
    const stmts = SCHEMA.map((s) => env.DB.prepare(s));
    DEFAULT_CATEGORIES.forEach(([id, name], i) => {
      stmts.push(env.DB.prepare(
        `INSERT OR IGNORE INTO categories (id, name, sort, hidden, updated_by, updated_at, seq)
         VALUES (?, ?, ?, 0, 'setup', ?, ?)`).bind(id, name, (i + 1) * 10, Date.now(), i + 1));
    });
    schemaReady = env.DB.batch(stmts).catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

// ---------- helpers ----------
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS },
  });
}
const err = (status, message) => json({ error: message }, status);

const enc = new TextEncoder();
function b64url(bytes) {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToStr(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return atob(s);
}
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg))));
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function parseUsers(env) {
  const users = {};
  String(env.PASSCODES || '').split(',').forEach((pair) => {
    const i = pair.lastIndexOf(':');
    if (i < 1) return;
    const name = pair.slice(0, i).trim();
    const code = pair.slice(i + 1).trim();
    if (name && /^\d{4,12}$/.test(code)) users[name] = code;
  });
  return users;
}

// Token is signed with TOKEN_SECRET + the user's passcode, so changing a
// passcode signs that person out of every device.
async function makeToken(env, user, code) {
  const payload = b64url(enc.encode(JSON.stringify({ u: user, iat: Date.now() })));
  return payload + '.' + (await hmac(env.TOKEN_SECRET + '|' + code, payload));
}
async function checkToken(env, req) {
  const m = /^Bearer\s+(.+)$/.exec(req.headers.get('Authorization') || '');
  if (!m) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return null;
  let data;
  try { data = JSON.parse(b64urlToStr(payload)); } catch { return null; }
  const code = parseUsers(env)[data.u];
  if (!code) return null;
  if (!safeEqual(sig, await hmac(env.TOKEN_SECRET + '|' + code, payload))) return null;
  if (Date.now() - data.iat > TOKEN_DAYS * 864e5) return null;
  return data.u;
}

const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const acct = (v) => (ACCOUNTS.includes(v) ? v : null);

// Every write bumps a single counter; rows carry the counter value so devices
// can ask "what changed since N" without missing anything.
const bumpSeq = (env) => env.DB.prepare(`UPDATE meta SET v = v + 1 WHERE k = 'seq'`);
const SEQ = `(SELECT v FROM meta WHERE k = 'seq')`;

// ---------- handlers ----------
async function login(req, env) {
  if (!env.TOKEN_SECRET || String(env.TOKEN_SECRET).length < 16) return err(500, 'TOKEN_SECRET is not set up');
  const users = parseUsers(env);
  if (!Object.keys(users).length) return err(500, 'PASSCODES is not set up');

  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const since = Date.now() - LOGIN_WINDOW_MS;
  await env.DB.prepare(`DELETE FROM login_fail WHERE ts < ?`).bind(since).run();
  const fails = await env.DB.prepare(`SELECT COUNT(*) AS n FROM login_fail WHERE ip = ? AND ts >= ?`).bind(ip, since).first();
  if (fails.n >= LOGIN_MAX_FAILS) return err(429, 'Too many wrong passcodes. Try again in 15 minutes.');

  let body = {};
  try { body = await req.json(); } catch {}
  const code = str(body.passcode, 20);
  const user = Object.keys(users).find((u) => safeEqual(users[u], code));
  if (!user) {
    await env.DB.prepare(`INSERT INTO login_fail (ip, ts) VALUES (?, ?)`).bind(ip, Date.now()).run();
    return err(401, 'Passcode not recognised');
  }
  return json({ user, token: await makeToken(env, user, code) });
}

async function sync(url, env) {
  const since = Math.max(0, parseInt(url.searchParams.get('since') || '0', 10) || 0);
  const [seqRow, cats, spends, photos, rems, regs] = await env.DB.batch([
    env.DB.prepare(`SELECT v FROM meta WHERE k = 'seq'`),
    env.DB.prepare(`SELECT id, name, sort, hidden, seq FROM categories WHERE seq > ? ORDER BY seq`).bind(since),
    env.DB.prepare(`SELECT id, date, description, supplier, amount_pence, category_id, account, notes, estimated,
                    created_by, created_at, updated_by, updated_at, deleted, seq,
                    regular_id, regular_date, manual
                    FROM spends WHERE seq > ? ORDER BY seq`).bind(since),
    env.DB.prepare(`SELECT id, spend_id, mime, size, created_by, created_at, deleted, seq
                    FROM photos WHERE seq > ? ORDER BY seq`).bind(since),
    env.DB.prepare(`SELECT * FROM reminders WHERE seq > ? ORDER BY seq`).bind(since),
    env.DB.prepare(`SELECT * FROM regulars WHERE seq > ? ORDER BY seq`).bind(since),
  ]);
  return json({
    seq: seqRow.results[0].v,
    categories: cats.results,
    spends: spends.results,
    photos: photos.results,
    reminders: rems.results,
    regulars: regs.results.map((g) => ({ ...g, amounts: JSON.parse(g.amounts || '[]') })),
  });
}

async function putSpend(id, req, env, user) {
  let b;
  try { b = await req.json(); } catch { return err(400, 'Bad request'); }
  const date = str(b.date, 10);
  const description = str(b.description, 200);
  const amount = Number(b.amount_pence);
  if (!DATE_RE.test(date)) return err(400, 'Date is missing');
  if (!description) return err(400, 'Say what it was');
  if (!Number.isInteger(amount) || amount < 0 || amount > 100_000_000) return err(400, 'Cost is not valid');

  const existing = await env.DB.prepare(`SELECT deleted FROM spends WHERE id = ?`).bind(id).first();
  if (existing && existing.deleted) return err(409, 'This spend was deleted on another device');

  const now = Date.now();
  await env.DB.batch([
    bumpSeq(env),
    env.DB.prepare(
      `INSERT INTO spends (id, date, description, supplier, amount_pence, category_id, account, notes, estimated,
                           created_by, created_at, updated_by, updated_at, deleted, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ${SEQ})
       ON CONFLICT(id) DO UPDATE SET
         date = excluded.date, description = excluded.description, supplier = excluded.supplier,
         amount_pence = excluded.amount_pence, category_id = excluded.category_id, account = excluded.account,
         notes = excluded.notes, estimated = excluded.estimated,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at,
         manual = CASE WHEN spends.regular_id IS NOT NULL THEN 1 ELSE spends.manual END,
         seq = excluded.seq`
    ).bind(id, date, description, str(b.supplier, 120), amount, str(b.category_id, 64) || null, acct(b.account),
           str(b.notes, 2000), b.estimated ? 1 : 0, user, now, user, now),
  ]);
  const row = await env.DB.prepare(`SELECT * FROM spends WHERE id = ?`).bind(id).first();
  return json(row);
}

async function deleteSpend(id, env, user) {
  const now = Date.now();
  await env.DB.batch([
    bumpSeq(env),
    env.DB.prepare(`UPDATE spends SET deleted = 1, updated_by = ?, updated_at = ?, seq = ${SEQ} WHERE id = ?`).bind(user, now, id),
    env.DB.prepare(`UPDATE photos SET deleted = 1, data = NULL, seq = ${SEQ} WHERE spend_id = ? AND deleted = 0`).bind(id),
    env.DB.prepare(`DELETE FROM file_chunks WHERE photo_id IN (SELECT id FROM photos WHERE spend_id = ?)`).bind(id),
  ]);
  return json({ ok: true });
}

async function putCategory(id, req, env, user) {
  let b;
  try { b = await req.json(); } catch { return err(400, 'Bad request'); }
  const name = str(b.name, 60);
  if (!name) return err(400, 'Category needs a name');
  const sort = Number.isInteger(b.sort) ? b.sort : 1000;
  await env.DB.batch([
    bumpSeq(env),
    env.DB.prepare(
      `INSERT INTO categories (id, name, sort, hidden, updated_by, updated_at, seq)
       VALUES (?, ?, ?, ?, ?, ?, ${SEQ})
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, sort = excluded.sort, hidden = excluded.hidden,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at, seq = excluded.seq`
    ).bind(id, name, sort, b.hidden ? 1 : 0, user, Date.now()),
  ]);
  return json(await env.DB.prepare(`SELECT id, name, sort, hidden, seq FROM categories WHERE id = ?`).bind(id).first());
}

const toB64 = (bytes) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const fromB64 = (b64) => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

async function putPhoto(id, url, req, env, user) {
  const spendId = url.searchParams.get('spend') || '';
  if (!ID_RE.test(spendId)) return err(400, 'Missing spend');
  const mime = (req.headers.get('Content-Type') || 'image/jpeg').split(';')[0].trim();
  if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(mime)) return err(400, 'Attachments must be a photo or a PDF');
  const buf = new Uint8Array(await req.arrayBuffer());
  if (!buf.length) return err(400, 'Empty file');
  if (buf.length > MAX_FILE_BYTES) return err(413, 'File is too large (5 MB maximum)');

  const existing = await env.DB.prepare(`SELECT deleted FROM photos WHERE id = ?`).bind(id).first();
  if (existing) return json({ ok: true, duplicate: true }); // already uploaded (retry after a dropped reply)

  // Chunks go in first; the photos row is written last, so a half-finished upload is never visible.
  const stmts = [env.DB.prepare(`DELETE FROM file_chunks WHERE photo_id = ?`).bind(id)];
  for (let i = 0, n = 0; i < buf.length; i += CHUNK_BYTES, n++) {
    stmts.push(env.DB.prepare(`INSERT INTO file_chunks (photo_id, idx, data) VALUES (?, ?, ?)`).bind(id, n, toB64(buf.subarray(i, i + CHUNK_BYTES))));
  }
  for (let i = 0; i < stmts.length; i += 5) await env.DB.batch(stmts.slice(i, i + 5));
  await env.DB.batch([
    bumpSeq(env),
    env.DB.prepare(
      `INSERT INTO photos (id, spend_id, mime, data, size, created_by, created_at, deleted, seq)
       VALUES (?, ?, ?, NULL, ?, ?, ?, 0, ${SEQ})`
    ).bind(id, spendId, mime, buf.length, user, Date.now()),
  ]);
  return json({ ok: true });
}

async function getPhoto(id, env) {
  const row = await env.DB.prepare(`SELECT mime, data, size FROM photos WHERE id = ? AND deleted = 0`).bind(id).first();
  if (!row) return err(404, 'File not found');
  let bytes;
  if (row.data) bytes = fromB64(row.data);
  else {
    const chunks = await env.DB.prepare(`SELECT data FROM file_chunks WHERE photo_id = ? ORDER BY idx`).bind(id).all();
    if (!chunks.results.length) return err(404, 'File not found');
    const parts = chunks.results.map((c) => fromB64(c.data));
    bytes = new Uint8Array(parts.reduce((t, p) => t + p.length, 0));
    let o = 0;
    parts.forEach((p) => { bytes.set(p, o); o += p.length; });
  }
  return new Response(bytes, {
    headers: { 'Content-Type': row.mime || 'image/jpeg', 'Cache-Control': 'private, max-age=31536000', ...CORS },
  });
}

async function deletePhoto(id, env) {
  await env.DB.batch([
    bumpSeq(env),
    env.DB.prepare(`UPDATE photos SET deleted = 1, data = NULL, seq = ${SEQ} WHERE id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM file_chunks WHERE photo_id = ?`).bind(id),
  ]);
  return json({ ok: true });
}

// ---------- reminders (stage 4: the app doesn't show these yet) ----------
const SOON_DAYS = 30;
const NOTIFY_HOUR_UK = 9;
let APP_URL = 'https://life-costs.richpschofield.workers.dev/';

async function putReminder(id, req, env, user) {
  let b;
  try { b = await req.json(); } catch { return err(400, 'Bad request'); }
  const name = str(b.name, 100);
  const kind = b.kind === 'repeat' ? 'repeat' : 'once';
  const due = str(b.due_date, 10);
  const every = kind === 'repeat' ? Number(b.every_months) : null;
  if (!name) return err(400, 'Give the reminder a name');
  if (!DATE_RE.test(due)) return err(400, 'Choose the due date');
  if (kind === 'repeat' && (!Number.isInteger(every) || every < 1 || every > 120)) return err(400, 'Repeat every 1 to 120 months');
  const anchor = Number.isInteger(b.anchor_day) && b.anchor_day >= 1 && b.anchor_day <= 31 ? b.anchor_day : +due.slice(8, 10);
  const last = DATE_RE.test(str(b.last_done_date, 10)) ? str(b.last_done_date, 10) : null;

  const existing = await env.DB.prepare(`SELECT deleted, done_at, done_by FROM reminders WHERE id = ?`).bind(id).first();
  if (existing && existing.deleted) return err(409, 'This reminder was deleted on another device');

  const now = Date.now();
  const doneAt = kind === 'once' && b.done ? (existing && existing.done_at) || now : null;
  const doneBy = doneAt ? (existing && existing.done_at ? existing.done_by : user) : null;
  await env.DB.batch([
    bumpSeq(env),
    env.DB.prepare(
      `INSERT INTO reminders (id, name, category_id, kind, due_date, every_months, anchor_day, notes,
                              done_at, done_by, last_done_date, created_by, created_at, updated_by, updated_at, deleted, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ${SEQ})
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, category_id = excluded.category_id, kind = excluded.kind,
         due_date = excluded.due_date, every_months = excluded.every_months, anchor_day = excluded.anchor_day,
         notes = excluded.notes, done_at = excluded.done_at, done_by = excluded.done_by,
         last_done_date = excluded.last_done_date, updated_by = excluded.updated_by,
         updated_at = excluded.updated_at, seq = excluded.seq`
    ).bind(id, name, str(b.category_id, 64) || null, kind, due, every, anchor, str(b.notes, 2000),
           doneAt, doneBy, last, user, now, user, now),
  ]);
  return json(await env.DB.prepare(`SELECT * FROM reminders WHERE id = ?`).bind(id).first());
}

async function deleteReminder(id, env, user) {
  await env.DB.batch([
    bumpSeq(env),
    env.DB.prepare(`UPDATE reminders SET deleted = 1, updated_by = ?, updated_at = ?, seq = ${SEQ} WHERE id = ?`).bind(user, Date.now(), id),
  ]);
  return json({ ok: true });
}

// UK calendar date and hour for a moment in time (handles BST/GMT).
function ukNow(ms) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; });
  return { date: `${p.year}-${p.month}-${p.day}`, hour: +p.hour };
}
const dayNum = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5;
const niceDate = (iso) => new Date(dayNum(iso) * 864e5).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

function notesFor(r, today) {
  const d = dayNum(r.due_date) - dayNum(today);
  if (d <= 0 && d >= -2) {
    return [{ kind: 'due', title: d === 0 ? `${r.name} is due today` : `${r.name} was due ${niceDate(r.due_date)}`, body: `Tap to open ${APP_NAME}. Mark it done when it’s sorted.` }];
  }
  if (d > 0 && d <= SOON_DAYS) {
    return [{ kind: 'soon', title: `${r.name} is due in ${d} day${d === 1 ? '' : 's'}`, body: `Due ${niceDate(r.due_date)}.` }];
  }
  return [];
}

async function runReminders(env, nowMs, force = false) {
  const { date: today, hour } = ukNow(nowMs);
  if (hour !== NOTIFY_HOUR_UK && !force) return { skipped: true, hour };
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE) return { skipped: true, reason: 'notifications not set up' };
  const rems = (await env.DB.prepare(`SELECT * FROM reminders WHERE deleted = 0 AND done_at IS NULL`).all()).results;
  const sentRows = (await env.DB.prepare(`SELECT reminder_id, due_date, kind FROM notes_sent`).all()).results;
  const sent = new Set(sentRows.map((s) => `${s.reminder_id}|${s.due_date}|${s.kind}`));
  const todo = [];
  rems.forEach((r) => notesFor(r, today).forEach((n) => {
    if (!sent.has(`${r.id}|${r.due_date}|${n.kind}`)) todo.push({ r, n });
  }));
  if (!todo.length) return { today, sent: 0 };

  const subs = (await env.DB.prepare(`SELECT * FROM push_subs`).all()).results;
  let ok = 0, failed = 0;
  for (const { r, n } of todo) {
    for (const s of subs) {
      const res = await sendPush(env, s, { title: n.title, body: n.body, tag: 'rem-' + r.id, url: APP_URL + '#reminders' });
      if (res.ok) ok++; else failed++;
    }
    await env.DB.prepare(`INSERT OR IGNORE INTO notes_sent (reminder_id, due_date, kind, sent_at) VALUES (?, ?, ?, ?)`)
      .bind(r.id, r.due_date, n.kind, Date.now()).run();
  }
  return { today, reminders: todo.length, delivered: ok, failed };
}

// ---------- Web Push (VAPID + aes128gcm, RFC 8291 / 8292) ----------
const bytesFromB64url = (s) => Uint8Array.from(b64urlToStr(s), (c) => c.charCodeAt(0));
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((t, p) => t + p.length, 0));
  let o = 0;
  parts.forEach((p) => { out.set(p, o); o += p.length; });
  return out;
};
async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

async function encryptPush(sub, plaintext) {
  const uaPub = bytesFromB64url(sub.p256dh);
  const authSecret = bytesFromB64url(sub.auth);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plaintext, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 0x10, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

let vapidKey = null;
async function vapidAuth(env, endpoint) {
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE) throw new Error('Notification keys are not set up');
  if (!vapidKey) {
    vapidKey = crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
      .catch((e) => { vapidKey = null; throw e; });
  }
  const aud = new URL(endpoint).origin;
  const head = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64url(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: APP_URL })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await vapidKey, enc.encode(head + '.' + body)));
  return `vapid t=${head}.${body}.${b64url(sig)}, k=${env.VAPID_PUBLIC}`;
}

async function sendPush(env, sub, message) {
  try {
    const body = await encryptPush(sub, enc.encode(JSON.stringify(message)));
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidAuth(env, sub.endpoint),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: 'normal',
      },
      body,
    });
    if (res.status === 404 || res.status === 410) {
      await env.DB.prepare(`DELETE FROM push_subs WHERE endpoint = ?`).bind(sub.endpoint).run();
      return { ok: false, gone: true, status: res.status };
    }
    if (res.ok) await env.DB.prepare(`UPDATE push_subs SET last_ok = ? WHERE endpoint = ?`).bind(Date.now(), sub.endpoint).run();
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function subscribe(req, env, user) {
  let b;
  try { b = await req.json(); } catch { return err(400, 'Bad request'); }
  const endpoint = str(b.endpoint, 1000);
  const p256dh = str(b.keys && b.keys.p256dh, 200);
  const auth = str(b.keys && b.keys.auth, 100);
  if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) return err(400, 'Notification details are not valid');
  await env.DB.prepare(
    `INSERT INTO push_subs (endpoint, user, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user = excluded.user, p256dh = excluded.p256dh, auth = excluded.auth`
  ).bind(endpoint, user, p256dh, auth, Date.now()).run();
  return json({ ok: true });
}

async function unsubscribe(req, env) {
  let b = {};
  try { b = await req.json(); } catch {}
  await env.DB.prepare(`DELETE FROM push_subs WHERE endpoint = ?`).bind(str(b.endpoint, 1000)).run();
  return json({ ok: true });
}

async function pushTest(req, env, user) {
  let b = {};
  try { b = await req.json(); } catch {}
  const subs = (await env.DB.prepare(`SELECT * FROM push_subs WHERE endpoint = ?`).bind(str(b.endpoint, 1000)).all()).results;
  if (!subs.length) return err(404, 'This device is not set up for notifications yet');
  const r = await sendPush(env, subs[0], { title: APP_NAME, body: `Test notification for ${user}. Reminders will look like this.`, tag: 'test', url: APP_URL + '#reminders' });
  if (!r.ok) return err(502, r.gone ? 'This device’s notification setup has expired. Turn notifications on again.' : 'Could not send (' + (r.status || r.error) + ')');
  return json({ ok: true });
}

// ---------- regular payments ----------
const FREQ_STEP = { month: 1, quarter: 3, year: 12 };
const isoOf = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12
function onDay(y, m, day) { // y/m may overflow; m is 1-based
  const t = new Date(Date.UTC(y, m - 1, 1));
  const yy = t.getUTCFullYear(), mm = t.getUTCMonth() + 1;
  return isoOf(yy, mm, Math.min(day, lastDay(yy, mm)));
}
// Payment dates, oldest first, up to and including `upto`.
// Same rules as the app: first date on or after the start; short months use their last day.
function regularDates(g, upto) {
  const step = FREQ_STEP[g.freq];
  if (!step) return [];
  const sy = +g.start_date.slice(0, 4), sm = +g.start_date.slice(5, 7);
  let y = sy, m = g.freq === 'year' ? g.month : sm;
  if (onDay(y, m, g.day) < g.start_date) { if (g.freq === 'year') y += 1; else m += 1; }
  const out = [];
  for (let k = 0; k < 1200; k++) {
    if (g.end_kind === 'count' && k >= g.end_count) break;
    const d = onDay(y, m + k * step, g.day);
    if (d > upto) break;
    if (g.end_kind === 'date' && g.end_date && d > g.end_date) break;
    out.push(d);
  }
  return out;
}
function amountOn(amounts, date) {
  let p = amounts.length ? amounts[0].pence : 0;
  amounts.forEach((a) => { if (a.from <= date) p = a.pence; });
  return p;
}
const regSpendId = (gid, date) => `rp-${gid}-${date}`;

// Add any payments that are due (date <= today) and not yet added. A deleted
// payment keeps its row, so a skipped month is never added back.
async function generateRegular(env, g, today) {
  if (g.deleted || g.stopped_at) return 0;
  const amounts = typeof g.amounts === 'string' ? JSON.parse(g.amounts) : g.amounts;
  const dates = regularDates(g, today);
  if (!dates.length) return 0;
  const have = new Set((await env.DB.prepare(`SELECT regular_date FROM spends WHERE regular_id = ?`).bind(g.id).all()).results.map((r) => r.regular_date));
  const missing = dates.filter((d) => !have.has(d));
  const now = Date.now();
  for (let i = 0; i < missing.length; i += 40) {
    const stmts = [bumpSeq(env)];
    missing.slice(i, i + 40).forEach((d) => stmts.push(env.DB.prepare(
      `INSERT OR IGNORE INTO spends (id, date, description, supplier, amount_pence, category_id, account, notes, estimated,
                                     created_by, created_at, updated_by, updated_at, deleted, seq, regular_id, regular_date, manual)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, NULL, 0, ${SEQ}, ?, ?, 0)`
    ).bind(regSpendId(g.id, d), d, g.description, g.supplier || '', amountOn(amounts, d), g.category_id || null,
           acct(g.account), g.notes || '', g.created_by || 'Regular payment', now, g.id, d)));
    await env.DB.batch(stmts);
  }
  return missing.length;
}

// After a price change: bring payments already added in line with the amount
// history, except ones edited by hand or deleted.
async function repriceRegular(env, g) {
  const amounts = typeof g.amounts === 'string' ? JSON.parse(g.amounts) : g.amounts;
  const rows = (await env.DB.prepare(`SELECT id, regular_date, amount_pence FROM spends WHERE regular_id = ? AND manual = 0 AND deleted = 0`).bind(g.id).all()).results;
  const change = rows.filter((r) => r.amount_pence !== amountOn(amounts, r.regular_date));
  for (let i = 0; i < change.length; i += 40) {
    const stmts = [bumpSeq(env)];
    change.slice(i, i + 40).forEach((r) => stmts.push(env.DB.prepare(`UPDATE spends SET amount_pence = ?, seq = ${SEQ} WHERE id = ?`).bind(amountOn(amounts, r.regular_date), r.id)));
    await env.DB.batch(stmts);
  }
  return change.length;
}

async function putRegular(id, req, env, user, nowMs = Date.now()) {
  let b;
  try { b = await req.json(); } catch { return err(400, 'Bad request'); }
  const existing = await env.DB.prepare(`SELECT * FROM regulars WHERE id = ?`).bind(id).first();
  if (existing && existing.deleted) return err(409, 'This regular payment was deleted on another device');
  const description = str(b.description, 200);
  if (!description) return err(400, 'Say what the payment is');
  // The schedule is fixed once created (changing it would move payments already added).
  const freq = existing ? existing.freq : str(b.freq, 10);
  const day = existing ? existing.day : Number(b.day);
  const month = existing ? existing.month : (freq === 'year' ? Number(b.month) : null);
  const start = existing ? existing.start_date : str(b.start_date, 10);
  if (!FREQ_STEP[freq]) return err(400, 'Choose how often');
  if (!Number.isInteger(day) || day < 1 || day > 31) return err(400, 'Day must be 1 to 31');
  if (freq === 'year' && (!Number.isInteger(month) || month < 1 || month > 12)) return err(400, 'Choose the month');
  if (!DATE_RE.test(start)) return err(400, 'Choose the start date');
  const endKind = ['never', 'date', 'count'].includes(b.end_kind) ? b.end_kind : 'never';
  const endDate = endKind === 'date' ? str(b.end_date, 10) : null;
  const endCount = endKind === 'count' ? Number(b.end_count) : null;
  if (endKind === 'date' && (!DATE_RE.test(endDate) || endDate < start)) return err(400, 'The end date must be after the start');
  if (endKind === 'count' && (!Number.isInteger(endCount) || endCount < 1 || endCount > 1200)) return err(400, 'Number of payments must be 1 to 1200');
  const amounts = (Array.isArray(b.amounts) ? b.amounts : [])
    .map((a) => ({ from: str(a && a.from, 10), pence: Number(a && a.pence) }))
    .filter((a) => DATE_RE.test(a.from) && Number.isInteger(a.pence) && a.pence >= 0 && a.pence <= 100_000_000)
    .sort((x, y) => x.from.localeCompare(y.from));
  if (!amounts.length) return err(400, 'Enter the amount');
  const dedup = amounts.filter((a, i) => i === amounts.length - 1 || amounts[i + 1].from !== a.from);
  const stopped = b.stopped ? (existing && existing.stopped_at) || Date.now() : null;
  const stoppedBy = stopped ? (existing && existing.stopped_at ? existing.stopped_by : user) : null;

  const now = Date.now();
  await env.DB.batch([
    bumpSeq(env),
    env.DB.prepare(
      `INSERT INTO regulars (id, description, supplier, category_id, account, notes, freq, day, month, start_date,
                             end_kind, end_date, end_count, amounts, stopped_at, stopped_by,
                             created_by, created_at, updated_by, updated_at, deleted, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ${SEQ})
       ON CONFLICT(id) DO UPDATE SET
         description = excluded.description, supplier = excluded.supplier, category_id = excluded.category_id,
         account = excluded.account, notes = excluded.notes, end_kind = excluded.end_kind, end_date = excluded.end_date,
         end_count = excluded.end_count, amounts = excluded.amounts, stopped_at = excluded.stopped_at,
         stopped_by = excluded.stopped_by, updated_by = excluded.updated_by, updated_at = excluded.updated_at,
         seq = excluded.seq`
    ).bind(id, description, str(b.supplier, 120), str(b.category_id, 64) || null, acct(b.account), str(b.notes, 2000),
           freq, day, month, start, endKind, endDate, endCount, JSON.stringify(dedup), stopped, stoppedBy,
           user, now, user, now),
  ]);
  const g = await env.DB.prepare(`SELECT * FROM regulars WHERE id = ?`).bind(id).first();
  const repriced = await repriceRegular(env, g);
  const added = await generateRegular(env, g, ukNow(nowMs).date);
  return json({ ...g, amounts: JSON.parse(g.amounts), added, repriced });
}

async function deleteRegular(id, env, user) {
  await env.DB.batch([
    bumpSeq(env),
    env.DB.prepare(`UPDATE regulars SET deleted = 1, stopped_at = COALESCE(stopped_at, ?), updated_by = ?, updated_at = ?, seq = ${SEQ} WHERE id = ?`).bind(Date.now(), user, Date.now(), id),
  ]);
  return json({ ok: true });
}

async function runRegulars(env, nowMs) {
  const today = ukNow(nowMs).date;
  const regs = (await env.DB.prepare(`SELECT * FROM regulars WHERE deleted = 0 AND stopped_at IS NULL`).all()).results;
  let added = 0;
  for (const g of regs) added += await generateRegular(env, g, today);
  return { today, added };
}

// ---------- router ----------
export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    APP_URL = url.origin + '/';
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'GET') {
      const page = await serveStatic(path);
      if (page) return page;
    }

    try {
      if (!env.DB) return err(500, 'The D1 database is not bound as DB');
      await ensureSchema(env);

      if (path === '/health' && req.method === 'GET') return json({ app: 'life-costs', ok: true });
      if (path === '/login' && req.method === 'POST') return login(req, env);
      if (env.DEV === '1' && path === '/dev/run-regulars' && req.method === 'POST') {
        return json(await runRegulars(env, Number(url.searchParams.get('now')) || Date.now()));
      }

      const user = await checkToken(env, req);
      if (!user) return err(401, 'Please sign in again');

      if (path === '/sync' && req.method === 'GET') return sync(url, env);
      if (path === '/push/key' && req.method === 'GET') return json({ key: env.VAPID_PUBLIC || null });
      if (path === '/push/subscribe' && req.method === 'POST') return subscribe(req, env, user);
      if (path === '/push/subscribe' && req.method === 'DELETE') return unsubscribe(req, env);
      if (path === '/push/test' && req.method === 'POST') return pushTest(req, env, user);

      const m = /^\/(spends|categories|photos|reminders|regulars)\/([^/]+)$/.exec(path);
      if (m) {
        const [, kind, id] = m;
        if (!ID_RE.test(id)) return err(400, 'Bad id');
        if (kind === 'spends' && req.method === 'PUT') return putSpend(id, req, env, user);
        if (kind === 'spends' && req.method === 'DELETE') return deleteSpend(id, env, user);
        if (kind === 'categories' && req.method === 'PUT') return putCategory(id, req, env, user);
        if (kind === 'photos' && req.method === 'PUT') return putPhoto(id, url, req, env, user);
        if (kind === 'photos' && req.method === 'GET') return getPhoto(id, env);
        if (kind === 'photos' && req.method === 'DELETE') return deletePhoto(id, env);
        if (kind === 'reminders' && req.method === 'PUT') return putReminder(id, req, env, user);
        if (kind === 'reminders' && req.method === 'DELETE') return deleteReminder(id, env, user);
        if (kind === 'regulars' && req.method === 'PUT') return putRegular(id, req, env, user, (env.DEV === '1' && Number(url.searchParams.get('now'))) || Date.now());
        if (kind === 'regulars' && req.method === 'DELETE') return deleteRegular(id, env, user);
      }
      return err(404, 'Not found');
    } catch (e) {
      return err(500, 'Server error: ' + (e && e.message ? e.message : String(e)));
    }
  },

  // Runs every hour (Cron trigger): adds regular payments whose day has come.
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      await ensureSchema(env);
      const now = event.scheduledTime || Date.now();
      await runRegulars(env, now);
      await runReminders(env, now);
    })());
  },
};
