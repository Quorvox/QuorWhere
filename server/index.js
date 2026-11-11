import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { sessionMiddleware, authRoutes, isAdmin, qidConfigured } from './auth.js';
import { makeRounds, countryName, provider } from './locations.js';
import { haversineKm, scoreForDistance, MAX_SCORE } from './scoring.js';
import { reverse } from './geocode.js';
import { roomsRoutes, roomPano, MAX_PLAYERS } from './rooms.js';
import { makeBotGame } from './bots.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3020);
const ROUNDS = 5;
const TIME_LIMITS = [0, 60, 120, 180];
const RANKED_LIMIT = 120; // в рейтинговой игре правила одинаковые для всех

export const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '4kb' }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY' });
  next();
});
app.use('/vendor/mapillary', express.static(path.join(here, '..', 'node_modules', 'mapillary-js', 'dist')));
for (const f of ['manrope', 'jetbrains-mono']) app.use(`/vendor/fonts/${f}`, express.static(path.join(here, '..', 'node_modules', '@fontsource', f, 'files'), { maxAge: '30d' }));
app.use('/vendor/maplibre', express.static(path.join(here, '..', 'node_modules', 'maplibre-gl', 'dist')));
app.get('/vendor/maplibre/leaflet-maplibre-gl.js', (req, res) => res.sendFile(path.join(here, '..', 'node_modules', '@maplibre', 'maplibre-gl-leaflet', 'leaflet-maplibre-gl.js')));
app.use('/vendor/pannellum', express.static(path.join(here, '..', 'node_modules', 'pannellum', 'build')));
app.use('/vendor/leaflet', express.static(path.join(here, '..', 'node_modules', 'leaflet', 'dist')));
app.use(express.static(path.join(here, '..', 'public')));
app.use(sessionMiddleware);
authRoutes(app);

// ---- простой лимит запросов на IP ----
const hits = new Map();
const limit = (name, max, windowMs) => (req, res, next) => {
  const k = `${name}:${req.ip}`, now = Date.now();
  const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) return res.status(429).json({ error: 'Слишком часто, подожди немного' });
  arr.push(now); hits.set(k, arr);
  next();
};
setInterval(() => hits.clear(), 3600_000).unref();

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(req.method, req.path, e.message);
  res.status(500).json({ error: 'Что-то пошло не так, попробуй ещё раз' });
});

// ---- отчёты клиента о сбоях панорамы (в лог pm2, чтобы понимать, у кого и почему не работает) ----
app.post('/api/client-log', limit('clog', 30, 3600_000), (req, res) => {
  const b = req.body || {}, cut = (v, n) => String(v ?? '').replace(/\s+/g, ' ').slice(0, n);
  console.warn(`[client] ${cut(b.kind, 30)} | webgl=${b.webgl === true} | ${cut(b.provider, 20)} | ${cut(b.msg, b.kind === 'diag' ? 1800 : 200)} | ${cut(b.ua, 160)}`);
  res.json({ ok: true });
});

// ---- картинка панорамы через наш сервер ----
// У части людей защита от отслеживания (Edge, расширения) режет домены Meta, и снимки Mapillary не грузятся.
// Тогда сервер сам скачивает картинку и отдаёт её с нашего домена. Отдаём только снимок ТЕКУЩЕГО раунда этого игрока.
const imgCache = new Map();
const panoAllowed = (sid, id) => {
  if (roomPano(sid) === id) return true;
  for (const g of db.prepare('SELECT rounds, current FROM games WHERE owner = ? AND finished = 0 ORDER BY created DESC LIMIT 3').all(sid)) {
    try { if (JSON.parse(g.rounds)[g.current]?.pano === id) return true; } catch {}
  }
  return false;
};
app.get('/api/pano-img/:id', limit('pimg', 120, 3600_000), wrap(async (req, res) => {
  const id = String(req.params.id);
  if (!/^\d{5,20}$/.test(id) || !panoAllowed(req.sid, id) || !process.env.MAPILLARY_TOKEN) return res.status(404).end();
  let buf = imgCache.get(id);
  if (!buf) {
    const meta = await (await fetch(`https://graph.mapillary.com/${id}?fields=thumb_2048_url&access_token=${encodeURIComponent(process.env.MAPILLARY_TOKEN)}`, { signal: AbortSignal.timeout(8000) })).json();
    if (!meta.thumb_2048_url) return res.status(404).end();
    const r = await fetch(meta.thumb_2048_url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return res.status(502).end();
    buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 6_000_000) return res.status(502).end();
    if (imgCache.size >= 60) imgCache.delete(imgCache.keys().next().value);
    imgCache.set(id, buf);
  }
  res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' }).send(buf);
}));

// ---- публичное ----
app.get('/api/config', (req, res) => res.json({
  provider: provider(),
  mapsKey: provider() === 'google' ? process.env.GOOGLE_MAPS_KEY : null,
  mapillaryToken: provider() === 'mapillary' ? process.env.MAPILLARY_TOKEN : null,
  tiles: process.env.TILES_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  quorvox: qidConfigured(),
  dev: process.env.DEV_LOGIN === '1' && process.env.NODE_ENV !== 'production',
  rounds: ROUNDS, maxScore: MAX_SCORE, timeLimits: TIME_LIMITS, rankedLimit: RANKED_LIMIT, maxPlayers: MAX_PLAYERS,
}));

// рейтинг = средний результат последних 10 рейтинговых партий
const ratingOf = (userId) => {
  const rows = db.prepare('SELECT total FROM games WHERE user_id = ? AND ranked = 1 AND finished = 1 ORDER BY created DESC LIMIT 10').all(userId);
  if (!rows.length) return { rating: null, games: 0 };
  return { rating: Math.round(rows.reduce((s, r) => s + r.total, 0) / rows.length), games: rows.length };
};

app.get('/api/me', (req, res) => {
  const u = req.user;
  res.json(u ? { name: u.name, qv: u.qv, admin: isAdmin(u), ...ratingOf(u.id) } : null);
});

app.get('/api/leaderboard', (req, res) => {
  const users = db.prepare(`SELECT DISTINCT u.id, u.name FROM games g JOIN users u ON u.id = g.user_id WHERE g.ranked = 1 AND g.finished = 1`).all();
  const rows = users.map((u) => {
    const r = ratingOf(u.id);
    const best = db.prepare('SELECT MAX(total) AS b FROM games WHERE user_id = ? AND ranked = 1 AND finished = 1').get(u.id).b;
    return { name: u.name, rating: r.rating, games: r.games, best };
  }).sort((a, b) => b.rating - a.rating || b.best - a.best).slice(0, 20);
  res.json(rows);
});

// ---- игра ----
const getGame = (req) => {
  const g = db.prepare('SELECT * FROM games WHERE id = ? AND owner = ?').get(String(req.params.id), req.sid);
  if (!g) return null;
  return { ...g, rounds: JSON.parse(g.rounds), guesses: JSON.parse(g.guesses), bot: g.bot ? JSON.parse(g.bot) : null };
};
const save = (g) => db.prepare('UPDATE games SET guesses = ?, current = ?, started = ?, finished = ?, total = ? WHERE id = ?')
  .run(JSON.stringify(g.guesses), g.current, g.started, g.finished ? 1 : 0, g.total, g.id);

// что видит клиент про текущий раунд: никаких координат ответа
const botTotal = (g) => g.bot ? g.bot.guesses.slice(0, g.guesses.length).reduce((s, b) => s + b.score, 0) : 0;
const roundView = (g) => ({
  gameId: g.id, round: g.current + 1, rounds: g.rounds.length, total: g.total,
  timeLimit: g.time_limit, ranked: !!g.ranked, startedAt: g.started, serverNow: Date.now(),
  pano: g.rounds[g.current].pano,
  answered: g.guesses.length > g.current,
  // дуэль: имя соперника, его счёт по уже раскрытым раундам и время, когда он «ответит» (сама догадка скрыта)
  opponent: g.bot ? { name: g.bot.name, bot: true, total: botTotal(g), answerAt: g.started + g.bot.guesses[g.current].delay } : null,
});

app.post('/api/games', limit('new', 20, 3600_000), wrap(async (req, res) => {
  const duel = req.body?.mode === 'duel';
  const ranked = req.body?.mode === 'ranked' || duel;
  if (ranked && !req.user) return res.status(401).json({ error: 'Для рейтинговой игры нужно войти через Quorvox ID' });
  const tl = ranked ? RANKED_LIMIT : Number(req.body?.timeLimit || 0);
  if (!TIME_LIMITS.includes(tl)) return res.status(400).json({ error: 'Неверный лимит времени' });
  const rounds = await makeRounds(ROUNDS);
  const id = crypto.randomBytes(8).toString('hex');
  const now = Date.now();
  const bot = duel ? makeBotGame(rounds, ratingOf(req.user.id).rating, tl) : null;
  db.prepare('INSERT INTO games (id, owner, user_id, time_limit, rounds, started, created, ranked, bot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.sid, req.user?.id ?? null, tl, JSON.stringify(rounds), now, now, ranked ? 1 : 0, bot ? JSON.stringify(bot) : null);
  res.json(roundView(getGame({ params: { id }, sid: req.sid })));
}));

app.get('/api/games/:id', (req, res) => {
  const g = getGame(req);
  if (!g) return res.status(404).json({ error: 'Игра не найдена' });
  res.json({ ...roundView(g), finished: !!g.finished });
});

app.post('/api/games/:id/guess', wrap(async (req, res) => {
  const g = getGame(req);
  if (!g || g.finished) return res.status(404).json({ error: 'Игра не найдена' });
  if (g.guesses.length > g.current) return res.status(409).json({ error: 'Ты уже ответил в этом раунде' });

  const { lat, lng } = req.body || {};
  const timedOut = g.time_limit > 0 && Date.now() > g.started + (g.time_limit + 3) * 1000;
  const valid = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const ans = g.rounds[g.current];

  let guess = { lat: null, lng: null, km: null, score: 0, timeout: true };
  if (valid && !timedOut) {
    const km = haversineKm(lat, lng, ans.lat, ans.lng);
    guess = { lat, lng, km: +km.toFixed(2), score: scoreForDistance(km), timeout: false };
  } else if (!valid && !timedOut) {
    return res.status(400).json({ error: 'Поставь точку на карте' });
  }
  g.guesses.push(guess);
  g.total += guess.score;
  save(g);
  const bg = g.bot?.guesses[g.current];
  res.json({
    guess, answer: { lat: ans.lat, lng: ans.lng, country: countryName(ans.cc) },
    total: g.total, last: g.current + 1 >= g.rounds.length,
    bot: bg ? { name: g.bot.name, guess: { lat: bg.lat, lng: bg.lng, km: bg.km, score: bg.score }, total: botTotal(g) } : undefined,
  });
}));

app.post('/api/games/:id/next', (req, res) => {
  const g = getGame(req);
  if (!g || g.finished) return res.status(404).json({ error: 'Игра не найдена' });
  if (g.guesses.length <= g.current) return res.status(409).json({ error: 'Сначала ответь в этом раунде' });
  if (g.current + 1 >= g.rounds.length) {
    g.finished = true; save(g);
    const bt = botTotal(g);
    return res.json({
      finished: true, total: g.total,
      rounds: g.rounds.map((r, i) => ({ answer: { lat: r.lat, lng: r.lng, country: countryName(r.cc) }, guess: g.guesses[i], bot: g.bot ? g.bot.guesses[i] : undefined })),
      duel: g.bot ? { name: g.bot.name, bot: true, total: bt, result: g.total > bt ? 'win' : g.total < bt ? 'loss' : 'draw' } : undefined,
    });
  }
  g.current += 1; g.started = Date.now(); save(g);
  res.json(roundView(g));
});

// ---- только админ: где мы на самом деле (для тестов) ----
app.get('/api/games/:id/hint', limit('hint', 60, 3600_000), wrap(async (req, res) => {
  if (!isAdmin(req.user)) return res.status(404).json({ error: 'Не найдено' }); // для остальных маршрута как будто нет
  const g = getGame(req);
  if (!g) return res.status(404).json({ error: 'Игра не найдена' });
  const r = g.rounds[g.current];
  const addr = await reverse(r.lat, r.lng, r.cc);
  res.json({
    round: g.current + 1, lat: r.lat, lng: r.lng, pano: r.pano, ...addr,
    map: `https://www.google.com/maps?q=${r.lat},${r.lng}`,
  });
}));

roomsRoutes(app, { limit, wrap, isAdmin, reverse });

app.use('/api', (req, res) => res.status(404).json({ error: 'Не найдено' }));

// в тестах порт открывает сам тест
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, '127.0.0.1', () => console.log(`QuorWhere на http://localhost:${PORT}`));
}
