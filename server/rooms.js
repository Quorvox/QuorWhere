// Игра с друзьями: комнаты до 5 человек. Состояние живёт в памяти (комнаты короткие),
// клиенты опрашивают GET /api/rooms/:code раз в секунду-две. Правильные ответы раунда
// отдаются только когда раунд закончился (все ответили или вышло время).
import crypto from 'node:crypto';
import { haversineKm, scoreForDistance } from './scoring.js';
import { countryName, makeRounds } from './locations.js';

export const MAX_PLAYERS = 5;
const ROUNDS = 5;
const IDLE_MS = 25_000;            // не опрашивал сервер столько — считаем отвалившимся
const TTL_MS = 3 * 3600_000;       // комнату без активности удаляем
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без похожих O/0, I/1

const rooms = new Map();           // code → room
const byPlayer = new Map();        // sid → code

const newCode = () => {
  for (;;) {
    const c = Array.from({ length: 4 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
    if (!rooms.has(c)) return c;
  }
};

const cleanName = (s, fallback) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20) || fallback;
const uniqueName = (room, name) => {
  const taken = new Set([...room.players.values()].map((p) => p.name.toLowerCase()));
  let n = name, i = 2;
  while (taken.has(n.toLowerCase())) n = `${name.slice(0, 17)} ${i++}`;
  return n;
};

const active = (room) => [...room.players.entries()].filter(([, p]) => Date.now() - p.seen < IDLE_MS);

// закрываем раунд, если все ответили или вышло время
function settle(room) {
  if (room.status !== 'playing' || room.phase !== 'guessing') return;
  const now = Date.now();
  const timeUp = room.limit > 0 && now > room.startedAt + room.limit * 1000;
  const act = active(room);
  const allIn = act.length > 0 && act.every(([, p]) => p.guesses[room.cur]);
  if (!timeUp && !allIn && act.length > 0) return;
  for (const [, p] of room.players) {
    if (!p.guesses[room.cur]) p.guesses[room.cur] = { lat: null, lng: null, km: null, score: 0, timeout: true };
  }
  for (const [, p] of room.players) p.total = p.guesses.reduce((s, g) => s + (g?.score || 0), 0);
  room.phase = 'reveal';
}

function view(room, sid) {
  settle(room);
  const me = room.players.get(sid);
  const rd = room.rounds[room.cur];
  const out = {
    code: room.code, status: room.status, phase: room.phase, host: room.host === sid, limit: room.limit,
    round: room.cur + 1, rounds: ROUNDS, startedAt: room.startedAt, serverNow: Date.now(), max: MAX_PLAYERS,
    players: [...room.players.entries()].map(([id, p]) => ({
      name: p.name, host: id === room.host, you: id === sid, total: p.total,
      guessed: room.status === 'playing' && !!p.guesses[room.cur], away: Date.now() - p.seen > IDLE_MS,
    })),
  };
  if (room.status === 'playing' || room.status === 'finished') {
    if (room.status === 'playing') {
      out.pano = rd.pano;
      out.answered = !!me?.guesses[room.cur];
    }
    if (room.phase === 'reveal' || room.status === 'finished') {
      out.reveal = {
        answer: { lat: rd.lat, lng: rd.lng, country: countryName(rd.cc) },
        guesses: [...room.players.values()].map((p) => ({ name: p.name, ...p.guesses[room.cur] })),
        last: room.cur + 1 >= ROUNDS,
      };
    }
  }
  if (room.status === 'finished') {
    out.final = {
      rounds: room.rounds.map((r, i) => ({
        answer: { lat: r.lat, lng: r.lng, country: countryName(r.cc) },
        guesses: [...room.players.values()].map((p) => ({ name: p.name, ...p.guesses[i] })),
      })),
    };
  }
  return out;
}

setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (now - r.touched > TTL_MS) { for (const id of r.players.keys()) if (byPlayer.get(id) === code) byPlayer.delete(id); rooms.delete(code); }
  }
}, 600_000).unref();

function leave(sid) {
  const code = byPlayer.get(sid);
  byPlayer.delete(sid);
  const room = rooms.get(code);
  if (!room) return;
  room.players.delete(sid);
  if (!room.players.size) { rooms.delete(code); return; }
  if (room.host === sid) room.host = [...room.players.keys()][0]; // ведущим становится следующий
}

// панорама текущего раунда комнаты, в которой сидит игрок (нужна для прокси-картинки)
export function roomPano(sid) {
  const room = rooms.get(byPlayer.get(sid));
  return room && room.status === 'playing' ? room.rounds[room.cur]?.pano ?? null : null;
}

export function roomsRoutes(app, { limit, wrap, isAdmin, reverse }) {
  const get = (req, res) => {
    const room = rooms.get(String(req.params.code || '').toUpperCase());
    if (!room || !room.players.has(req.sid)) { res.status(404).json({ error: 'Комната не найдена' }); return null; }
    room.touched = Date.now(); room.players.get(req.sid).seen = Date.now();
    return room;
  };

  app.post('/api/rooms', limit('room', 15, 3600_000), (req, res) => {
    const tl = Number(req.body?.timeLimit || 0);
    if (![0, 60, 120, 180].includes(tl)) return res.status(400).json({ error: 'Неверный лимит времени' });
    leave(req.sid);
    const code = newCode();
    const room = { code, host: req.sid, limit: tl, status: 'lobby', phase: 'guessing', rounds: [], cur: 0, startedAt: 0, players: new Map(), touched: Date.now() };
    room.players.set(req.sid, { name: cleanName(req.user?.name || req.body?.name, 'Игрок'), total: 0, guesses: [], seen: Date.now() });
    rooms.set(code, room); byPlayer.set(req.sid, code);
    res.json(view(room, req.sid));
  });

  app.post('/api/rooms/:code/join', limit('join', 60, 3600_000), (req, res) => {
    const code = String(req.params.code || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return res.status(404).json({ error: 'Такой комнаты нет' });
    if (!room.players.has(req.sid)) {
      if (room.status !== 'lobby') return res.status(409).json({ error: 'Игра уже идёт, зайти нельзя' });
      if (room.players.size >= MAX_PLAYERS) return res.status(409).json({ error: `В комнате уже ${MAX_PLAYERS} игроков` });
      leave(req.sid);
      room.players.set(req.sid, { name: uniqueName(room, cleanName(req.user?.name || req.body?.name, 'Игрок')), total: 0, guesses: [], seen: Date.now() });
      byPlayer.set(req.sid, code);
    }
    room.touched = Date.now();
    res.json(view(room, req.sid));
  });

  app.get('/api/rooms/:code', (req, res) => { const room = get(req, res); if (room) res.json(view(room, req.sid)); });

  app.post('/api/rooms/:code/start', wrap(async (req, res) => {
    const room = get(req, res); if (!room) return;
    if (room.host !== req.sid) return res.status(403).json({ error: 'Начать может только ведущий' });
    if (room.status !== 'lobby') return res.status(409).json({ error: 'Игра уже началась' });
    room.status = 'starting';
    try { room.rounds = await makeRounds(ROUNDS); }
    catch (e) { room.status = 'lobby'; throw e; }
    room.status = 'playing'; room.phase = 'guessing'; room.cur = 0; room.startedAt = Date.now();
    res.json(view(room, req.sid));
  }));

  app.post('/api/rooms/:code/guess', (req, res) => {
    const room = get(req, res); if (!room) return;
    settle(room);
    if (room.status !== 'playing' || room.phase !== 'guessing') return res.status(409).json({ error: 'Раунд уже закончился' });
    const me = room.players.get(req.sid);
    if (me.guesses[room.cur]) return res.status(409).json({ error: 'Ты уже ответил' });
    const { lat, lng } = req.body || {};
    if (!(Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return res.status(400).json({ error: 'Поставь точку на карте' });
    const a = room.rounds[room.cur];
    const km = haversineKm(lat, lng, a.lat, a.lng);
    me.guesses[room.cur] = { lat, lng, km: +km.toFixed(2), score: scoreForDistance(km), timeout: false };
    me.total = me.guesses.reduce((s, g) => s + (g?.score || 0), 0);
    res.json(view(room, req.sid)); // settle внутри закроет раунд, если ответили все
  });

  app.post('/api/rooms/:code/next', (req, res) => {
    const room = get(req, res); if (!room) return;
    if (room.host !== req.sid) return res.status(403).json({ error: 'Дальше двигает только ведущий' });
    settle(room);
    if (room.status !== 'playing' || room.phase !== 'reveal') return res.status(409).json({ error: 'Раунд ещё идёт' });
    if (room.cur + 1 >= ROUNDS) room.status = 'finished';
    else { room.cur += 1; room.phase = 'guessing'; room.startedAt = Date.now(); }
    res.json(view(room, req.sid));
  });

  app.post('/api/rooms/:code/leave', (req, res) => { leave(req.sid); res.json({ ok: true }); });

  // только админ: где мы на самом деле в текущем раунде комнаты
  app.get('/api/rooms/:code/hint', limit('hint', 60, 3600_000), wrap(async (req, res) => {
    if (!isAdmin(req.user)) return res.status(404).json({ error: 'Не найдено' });
    const room = get(req, res); if (!room) return;
    if (room.status !== 'playing') return res.status(409).json({ error: 'Игра не идёт' });
    const r = room.rounds[room.cur];
    const addr = await reverse(r.lat, r.lng, r.cc);
    res.json({ round: room.cur + 1, lat: r.lat, lng: r.lng, pano: r.pano, ...addr, map: `https://www.google.com/maps?q=${r.lat},${r.lng}` });
  }));
}
