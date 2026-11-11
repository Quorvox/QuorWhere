// Сессии (cookie → запись в SQLite) и вход через Quorvox ID.
import crypto from 'node:crypto';
import { db } from './db.js';
import { quorvoxId } from './quorvox-id.mjs';

const COOKIE = 'qw_sid';
const isProd = () => process.env.NODE_ENV === 'production';
export const publicUrl = () => (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3020}`).replace(/\/$/, '');

// админ — по Quorvox ID (QV-xxxxxxxx) или по sub; список в ADMIN_QUORVOX_IDS через запятую
const adminSet = () => new Set((process.env.ADMIN_QUORVOX_IDS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
export function isAdmin(user) {
  if (!user) return false;
  const s = adminSet();
  return [user.qv, user.sub].some((v) => v && s.has(String(v).toLowerCase()));
}

export function sessionMiddleware(req, res, next) {
  const m = new RegExp(`(?:^|; )${COOKIE}=([a-f0-9]{48})`).exec(req.headers.cookie || '');
  let sid = m?.[1];
  let row = sid && db.prepare('SELECT data FROM sessions WHERE sid = ?').get(sid);
  if (!row) {
    sid = crypto.randomBytes(24).toString('hex');
    db.prepare('INSERT INTO sessions (sid, data, updated) VALUES (?, ?, ?)').run(sid, '{}', Date.now());
    res.append('Set-Cookie', `${COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${publicUrl().startsWith('https') ? '; Secure' : ''}`);
    row = { data: '{}' };
  }
  const data = JSON.parse(row.data);
  req.sid = sid;
  req.session = data;
  const dirty = JSON.stringify(data);
  // сохраняем в конце ответа, если что-то поменялось
  res.on('finish', () => {
    const now = JSON.stringify(req.session);
    if (now !== dirty) db.prepare('UPDATE sessions SET data = ?, updated = ? WHERE sid = ?').run(now, Date.now(), sid);
  });
  req.user = data.userId ? db.prepare('SELECT * FROM users WHERE id = ?').get(data.userId) : null;
  next();
}

// ---- Quorvox ID ----
let client;
export const qidConfigured = () => !!(process.env.QUORVOX_CLIENT_ID && process.env.QUORVOX_CLIENT_SECRET);
function qid() {
  return (client ||= quorvoxId({
    issuer: process.env.QUORVOX_ISSUER || 'https://id.quorvox.ru',
    clientId: process.env.QUORVOX_CLIENT_ID,
    clientSecret: process.env.QUORVOX_CLIENT_SECRET,
    redirectUri: publicUrl() + '/auth/quorvox/callback',
  }));
}

function upsertUser(sub, qv, name) {
  db.prepare(`INSERT INTO users (sub, qv, name, created) VALUES (?, ?, ?, ?)
              ON CONFLICT(sub) DO UPDATE SET qv = excluded.qv, name = excluded.name`).run(sub, qv || null, name, Date.now());
  return db.prepare('SELECT * FROM users WHERE sub = ?').get(sub);
}

export function authRoutes(app) {
  app.get('/auth/quorvox', async (req, res) => {
    if (!qidConfigured()) return res.status(503).send('Вход через Quorvox ID не настроен');
    try { res.redirect(await qid().loginUrl(req.session)); }
    catch (e) { console.error('quorvox id:', e.message); res.status(502).send('Quorvox ID сейчас недоступен'); }
  });

  app.get('/auth/quorvox/callback', async (req, res) => {
    try {
      const c = await qid().handleCallback(req.query, req.session);
      const name = String(c.name || c.email?.split('@')[0] || 'Игрок').slice(0, 40);
      req.session.userId = upsertUser(c.sub, c.quorvox_id, name).id;
      res.redirect('/');
    } catch (e) {
      console.error('quorvox id:', e.message);
      res.redirect('/?auth=error');
    }
  });

  app.post('/auth/logout', (req, res) => { delete req.session.userId; res.json({ ok: true }); });

  // Вход «понарошку» для локальных тестов. Включается только DEV_LOGIN=1 и никогда в production.
  if (process.env.DEV_LOGIN === '1' && !isProd()) {
    app.get('/auth/dev', (req, res) => {
      const admin = req.query.as === 'admin';
      const sub = admin ? 'dev-admin' : 'dev-user';
      const qv = admin ? 'QV-DEVADMIN' : 'QV-DEVUSER';
      req.session.userId = upsertUser(sub, qv, admin ? 'Dev Admin' : 'Dev Player').id;
      res.redirect('/');
    });
    console.warn('⚠ DEV_LOGIN включён — только для локальной разработки');
  }
}
