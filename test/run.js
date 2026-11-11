// Сквозной тест без Google-ключа: игра, очки, защита ответов и админская подсказка
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.resolve('.test-data-'));
Object.assign(process.env, { DATA_DIR: tmp, DEV_LOGIN: '1', ADMIN_QUORVOX_IDS: 'QV-DEVADMIN', GOOGLE_MAPS_KEY: '', GOOGLE_SERVER_KEY: '', NODE_ENV: 'test' });

const { haversineKm, scoreForDistance } = await import('../server/scoring.js');
const { app } = await import('../server/index.js');
const server = app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

let ok = 0;
const t = async (name, fn) => { try { await fn(); ok++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.message); process.exitCode = 1; } };

// «браузер» с cookie
const client = () => {
  let cookie = '';
  return async (url, opts = {}) => {
    const r = await fetch(base + url, { redirect: 'manual', ...opts, headers: { 'Content-Type': 'application/json', cookie, ...opts.headers }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const sc = r.headers.getSetCookie?.() || [];
    if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ') || cookie;
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text, headers: r.headers };
  };
};

console.log('очки');
await t('одна точка = 0 км = 5000', () => { assert.equal(scoreForDistance(haversineKm(10, 10, 10, 10)), 5000); });
await t('Берлин–Париж ≈ 878 км', () => { const d = haversineKm(52.52, 13.4, 48.86, 2.35); assert.ok(d > 870 && d < 886, d); });
await t('дальше — меньше очков', () => { assert.ok(scoreForDistance(100) > scoreForDistance(1000)); assert.ok(scoreForDistance(20000) < 5); });

console.log('игра');
const guest = client();
let g;
await t('старт игры', async () => {
  const r = await guest('/api/games', { method: 'POST', body: { timeLimit: 0 } });
  assert.equal(r.status, 200); g = r.json;
  assert.equal(g.round, 1); assert.equal(g.rounds, 5);
  assert.ok(!('lat' in g) && !('answer' in g), 'ответ не должен утекать в старте');
});
await t('неверный лимит времени отклоняется', async () => { assert.equal((await guest('/api/games', { method: 'POST', body: { timeLimit: 999 } })).status, 400); });
await t('чужая сессия не видит мою игру', async () => { assert.equal((await client()(`/api/games/${g.gameId}`)).status, 404); });
await t('next без ответа нельзя', async () => { assert.equal((await guest(`/api/games/${g.gameId}/next`, { method: 'POST' })).status, 409); });
await t('кривые координаты отклоняются', async () => { assert.equal((await guest(`/api/games/${g.gameId}/guess`, { method: 'POST', body: { lat: 999, lng: 0 } })).status, 400); });

let total = 0;
for (let i = 1; i <= 5; i++) {
  await t(`раунд ${i}: догадка и ответ`, async () => {
    const r = await guest(`/api/games/${g.gameId}/guess`, { method: 'POST', body: { lat: 0, lng: 0 } });
    assert.equal(r.status, 200);
    assert.ok(r.json.answer.country && Number.isFinite(r.json.answer.lat));
    assert.ok(r.json.guess.score >= 0 && r.json.guess.score <= 5000);
    total += r.json.guess.score; assert.equal(r.json.total, total);
    assert.equal((await guest(`/api/games/${g.gameId}/guess`, { method: 'POST', body: { lat: 0, lng: 0 } })).status, 409, 'второй ответ в том же раунде');
    const n = await guest(`/api/games/${g.gameId}/next`, { method: 'POST' });
    assert.equal(n.status, 200);
    if (i < 5) assert.equal(n.json.round, i + 1); else { assert.equal(n.json.finished, true); assert.equal(n.json.total, total); assert.equal(n.json.rounds.length, 5); }
  });
}
await t('страны в одной игре не повторяются', async () => {
  const r = await guest(`/api/games`, { method: 'POST', body: {} });
  const id = r.json.gameId; const seen = new Set();
  for (let i = 0; i < 5; i++) { const x = await guest(`/api/games/${id}/guess`, { method: 'POST', body: { lat: 1, lng: 1 } }); seen.add(x.json.answer.country); await guest(`/api/games/${id}/next`, { method: 'POST' }); }
  assert.equal(seen.size, 5);
});

console.log('админ');
await t('гость и обычный игрок не видят подсказку', async () => {
  const r = await guest('/api/games', { method: 'POST', body: {} });
  assert.equal((await guest(`/api/games/${r.json.gameId}/hint`)).status, 404);
  const u = client(); await u('/auth/dev');
  const r2 = await u('/api/games', { method: 'POST', body: {} });
  assert.equal((await u(`/api/games/${r2.json.gameId}/hint`)).status, 404);
  assert.equal((await u('/api/me')).json.admin, false);
});
await t('админ получает ответ и адрес', async () => {
  const a = client(); await a('/auth/dev?as=admin');
  assert.equal((await a('/api/me')).json.admin, true);
  const r = await a('/api/games', { method: 'POST', body: {} });
  const h = await a(`/api/games/${r.json.gameId}/hint`);
  assert.equal(h.status, 200);
  assert.ok(Number.isFinite(h.json.lat) && h.json.country, JSON.stringify(h.json));
  console.log('     подсказка:', [h.json.country, h.json.city, h.json.street].filter(Boolean).join(' / '));
});
await t('рейтинговая игра: гостю нельзя, вошедшему можно, лимит 120 с', async () => {
  assert.equal((await guest('/api/games', { method: 'POST', body: { mode: 'ranked' } })).status, 401);
  const u = client(); await u('/auth/dev');
  const r = await u('/api/games', { method: 'POST', body: { mode: 'ranked', timeLimit: 0 } });
  assert.equal(r.status, 200); assert.equal(r.json.timeLimit, 120); assert.equal(r.json.ranked, true);
  for (let i = 0; i < 5; i++) { await u(`/api/games/${r.json.gameId}/guess`, { method: 'POST', body: { lat: 0, lng: 0 } }); await u(`/api/games/${r.json.gameId}/next`, { method: 'POST' }); }
  const me = (await u('/api/me')).json;
  assert.equal(me.games, 1); assert.ok(me.rating >= 0);
});
await t('одиночная игра в рейтинг не попадает', async () => {
  const u = client(); await u('/auth/dev?as=admin');
  const r = await u('/api/games', { method: 'POST', body: { mode: 'solo' } });
  for (let i = 0; i < 5; i++) { await u(`/api/games/${r.json.gameId}/guess`, { method: 'POST', body: { lat: 0, lng: 0 } }); await u(`/api/games/${r.json.gameId}/next`, { method: 'POST' }); }
  const lb = (await guest('/api/leaderboard')).json;
  assert.equal(lb.length, 1); assert.equal(lb[0].name, 'Dev Player');
});

console.log('комнаты');
const mk = (name) => { const c = client(); c.who = name; return c; };
const host = mk('Хост'), p2 = mk('Второй'), p3 = mk('Третий'), p4 = mk('Четвёртый'), p5 = mk('Пятый'), p6 = mk('Шестой');
let code;
await t('создание комнаты и вход до 5 человек', async () => {
  const r = await host('/api/rooms', { method: 'POST', body: { timeLimit: 0, name: 'Хост' } });
  assert.equal(r.status, 200); code = r.json.code; assert.match(code, /^[A-Z2-9]{4}$/); assert.equal(r.json.host, true);
  for (const p of [p2, p3, p4, p5]) assert.equal((await p(`/api/rooms/${code}/join`, { method: 'POST', body: { name: p.who } })).status, 200);
  const j = await p6(`/api/rooms/${code}/join`, { method: 'POST', body: { name: 'Шестой' } });
  assert.equal(j.status, 409, 'шестой не должен войти');
  assert.equal((await client()('/api/rooms/ZZZZ/join', { method: 'POST', body: {} })).status, 404);
  assert.equal((await host(`/api/rooms/${code}`)).json.players.length, 5);
});
await t('одинаковые имена получают суффикс', async () => {
  const h = mk('x'), a = mk('x');
  const r = await h('/api/rooms', { method: 'POST', body: { name: 'Аня' } });
  const j = await a(`/api/rooms/${r.json.code}/join`, { method: 'POST', body: { name: 'Аня' } });
  const names = j.json.players.map((p) => p.name); assert.equal(new Set(names).size, 2, names.join());
});
await t('начать может только ведущий', async () => {
  assert.equal((await p2(`/api/rooms/${code}/start`, { method: 'POST' })).status, 403);
  const r = await host(`/api/rooms/${code}/start`, { method: 'POST' });
  assert.equal(r.status, 200); assert.equal(r.json.status, 'playing'); assert.equal(r.json.round, 1);
  assert.equal((await host(`/api/rooms/${code}/start`, { method: 'POST' })).status, 409);
});
await t('после старта зайти нельзя', async () => { assert.equal((await mk('z')(`/api/rooms/${code}/join`, { method: 'POST', body: { name: 'z' } })).status, 409); });
const all = [host, p2, p3, p4, p5];
for (let round = 1; round <= 5; round++) {
  await t(`комната, раунд ${round}: ответ скрыт до конца раунда, потом виден всем`, async () => {
    for (let i = 0; i < 4; i++) {
      const r = await all[i](`/api/rooms/${code}/guess`, { method: 'POST', body: { lat: i * 10, lng: i * 10 } });
      assert.equal(r.status, 200);
      assert.equal(r.json.reveal, undefined, 'ответ не должен утекать, пока не ответили все');
      assert.equal((await all[i](`/api/rooms/${code}/guess`, { method: 'POST', body: { lat: 1, lng: 1 } })).status, 409, 'повторный ответ');
    }
    assert.equal((await host(`/api/rooms/${code}/next`, { method: 'POST' })).status, 409, 'next до конца раунда нельзя');
    const last = await all[4](`/api/rooms/${code}/guess`, { method: 'POST', body: { lat: 40, lng: 40 } });
    assert.equal(last.json.phase, 'reveal'); assert.equal(last.json.reveal.guesses.length, 5); assert.ok(Number.isFinite(last.json.reveal.answer.lat));
    assert.equal((await p2(`/api/rooms/${code}/next`, { method: 'POST' })).status, 403, 'next только у ведущего');
    const n = await host(`/api/rooms/${code}/next`, { method: 'POST' });
    assert.equal(n.status, 200);
    if (round < 5) { assert.equal(n.json.round, round + 1); assert.equal(n.json.phase, 'guessing'); }
    else { assert.equal(n.json.status, 'finished'); assert.equal(n.json.final.rounds.length, 5); }
  });
}
await t('админская подсказка в комнате: только админ', async () => {
  const a = mk('Админ'); await a('/auth/dev?as=admin');
  const r = await a('/api/rooms', { method: 'POST', body: {} });
  await a(`/api/rooms/${r.json.code}/start`, { method: 'POST' });
  assert.equal((await a(`/api/rooms/${r.json.code}/hint`)).status, 200);
  assert.equal((await mk('Чужой')(`/api/rooms/${r.json.code}/hint`)).status, 404);
});
await t('выход ведущего передаёт комнату следующему', async () => {
  const h = mk('h'), b = mk('b');
  const r = await h('/api/rooms', { method: 'POST', body: { name: 'Хозяин' } });
  await b(`/api/rooms/${r.json.code}/join`, { method: 'POST', body: { name: 'Гость' } });
  await h(`/api/rooms/${r.json.code}/leave`, { method: 'POST' });
  const s = await b(`/api/rooms/${r.json.code}`);
  assert.equal(s.json.host, true); assert.equal(s.json.players.length, 1);
});

console.log(`\n${ok} проверок прошло${process.exitCode ? ', есть падения' : ''}`);
server.close();
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} // на Windows база ещё открыта — не страшно
process.exit(process.exitCode || 0);
