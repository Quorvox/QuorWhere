// Игра с друзьями: лобби, общие раунды, общий счёт. Состояние комнаты опрашиваем раз в 1,2 с.
import { $, api, el, S, COLORS, show, consent, loadGoogle, showPano, initMap, addBase, pinIcon, resetRoundUi, drawReveal, startTimer, setupAdmin, fmtKm } from './common.js';

let v = null, code = null, poll = null, marker = null, stopTimer = () => {}, seen = '', fMap, onExit = () => {};
const KEY = 'qw_room';

export const roomLink = (c) => `${location.origin}/?room=${c}`;

export async function createRoom({ timeLimit, name }, exit) {
  onExit = exit || (() => {});
  enter(await api('/api/rooms', { method: 'POST', body: { timeLimit, name } }));
}
export async function joinRoom(c, name, exit) {
  onExit = exit || (() => {});
  enter(await api(`/api/rooms/${encodeURIComponent(c.toUpperCase())}/join`, { method: 'POST', body: { name } }));
}
// вернуться в комнату после перезагрузки страницы
export async function resume(exit) {
  let c; try { c = sessionStorage.getItem(KEY); } catch {}
  if (!c) return false;
  onExit = exit || (() => {});
  try { enter(await api(`/api/rooms/${c}`)); return true; } catch { try { sessionStorage.removeItem(KEY); } catch {} return false; }
}

function enter(view) {
  code = view.code; seen = '';
  try { sessionStorage.setItem(KEY, code); } catch {}
  history.replaceState(null, '', location.pathname);
  $('exitBtn').onclick = leave; $('lobbyLeave').onclick = leave;
  $('startRoomBtn').onclick = start;
  $('copyBtn').onclick = copyLink;
  setupAdmin(() => `/api/rooms/${code}/hint`);
  S.onMapClick = (ll) => {
    if (!v || v.status !== 'playing' || v.phase !== 'guessing' || v.answered) return;
    if (marker) marker.setLatLng(ll); else marker = L.marker(ll, { icon: pinIcon('guess') }).addTo(S.layer);
    $('guessBtn').disabled = false; $('guessBtn').textContent = 'Угадать';
  };
  $('guessBtn').onclick = () => submitGuess();
  $('nextBtn').onclick = next;
  clearInterval(poll);
  render(view);
  poll = setInterval(tick, 1200);
}

async function tick() {
  try { render(await api(`/api/rooms/${code}`)); }
  catch (e) { if (/не найдена/.test(e.message)) { stop(); alert('Комната закрыта или тебя из неё убрали.'); onExit(); } }
}

function stop() {
  clearInterval(poll); poll = null; stopTimer(); v = null; marker = null;
  try { sessionStorage.removeItem(KEY); } catch {}
}
async function leave() { const c = code; stop(); api(`/api/rooms/${c}/leave`, { method: 'POST' }).catch(() => {}); onExit(); }

async function copyLink() {
  try { await navigator.clipboard.writeText(roomLink(code)); $('copyBtn').textContent = 'Скопировано'; setTimeout(() => { $('copyBtn').textContent = 'Копировать'; }, 1500); }
  catch { $('roomLink').select(); }
}

async function start() {
  $('startRoomBtn').disabled = true; $('lobbyErr').hidden = true;
  try {
    if (!(await consent())) return;
    await loadGoogle();
    render(await api(`/api/rooms/${code}/start`, { method: 'POST' }));
  } catch (e) { $('lobbyErr').textContent = e.message; $('lobbyErr').hidden = false; }
  finally { $('startRoomBtn').disabled = false; }
}

async function submitGuess() {
  const ll = marker?.getLatLng();
  if (!ll || !v || v.answered) return;
  $('guessBtn').disabled = true; $('guessBtn').textContent = 'Ждём остальных…';
  try { render(await api(`/api/rooms/${code}/guess`, { method: 'POST', body: { lat: ll.lat, lng: ll.lng } })); }
  catch (e) { alert(e.message); $('guessBtn').disabled = false; $('guessBtn').textContent = 'Угадать'; }
}

async function next() {
  $('nextBtn').disabled = true;
  try { render(await api(`/api/rooms/${code}/next`, { method: 'POST' })); } catch (e) { alert(e.message); $('nextBtn').disabled = false; }
}

// ---------- отрисовка по состоянию комнаты ----------
const sw = (i) => el('i', { className: 'sw', style: `background:${COLORS[i % COLORS.length]}` });

function render(view) {
  v = view;
  if (v.status === 'lobby' || v.status === 'starting') return renderLobby();
  if (v.status === 'finished') return renderFinal();
  renderGame();
}

function renderLobby() {
  if (seen !== 'lobby') { show('lobby'); seen = 'lobby'; }
  $('roomCode').textContent = v.code;
  $('roomLink').value = roomLink(v.code);
  $('plCount').textContent = `${v.players.length}/${v.max}`;
  const ul = $('plList'); ul.replaceChildren();
  v.players.forEach((p, i) => ul.append(el('li', {}, sw(i), el('span', { textContent: p.name }), el('span', { className: 'tag', textContent: [p.host ? 'ведущий' : '', p.you ? 'ты' : ''].filter(Boolean).join(' · ') }))));
  for (let i = v.players.length; i < v.max; i++) ul.append(el('li', { className: 'empty' }, el('span', { textContent: 'Свободное место' })));
  const lim = v.limit ? `${v.limit / 60 < 1 ? v.limit + ' с' : v.limit / 60 + ' мин'} на раунд` : 'без лимита времени';
  $('lobbyHint').textContent = v.host ? `Пять раундов, ${lim}. Начинай, когда все зашли.` : `Ждём, пока ведущий начнёт игру. Пять раундов, ${lim}.`;
  $('startRoomBtn').hidden = !v.host;
  $('startRoomBtn').textContent = v.status === 'starting' ? 'Подбираю места…' : 'Начать игру';
}

function renderBoard() {
  const b = $('roomBoard'); b.hidden = false; b.replaceChildren();
  v.players.forEach((p, i) => b.append(el('div', {}, sw(i), el('span', { className: 'nm', textContent: p.name + (p.away ? ' (нет связи)' : '') }),
    el('span', { className: p.guessed ? 'ok' : 'sc', textContent: v.phase === 'guessing' ? (p.guessed ? '✓' : '…') : p.total.toLocaleString('ru') }))));
}

function renderGame() {
  const key = `${v.round}:${v.phase}`;
  const newRound = !seen.startsWith(`${v.round}:`);
  const me = v.players.findIndex((p) => p.you);
  if (seen === 'lobby' || seen === '' || seen === 'final') { show('game'); initMap(); }
  if (newRound) {
    marker = null;
    resetRoundUi({ round: v.round, rounds: v.rounds, total: v.players[me]?.total ?? 0 });
    showPano(v.pano);
    stopTimer();
    stopTimer = startTimer({ startedAt: v.startedAt, limit: v.limit, serverNow: v.serverNow, onEnd: () => { if (!v.answered && marker) submitGuess(); } });
  }
  if (v.phase === 'guessing' && v.answered) { $('guessBtn').disabled = true; $('guessBtn').textContent = 'Ждём остальных…'; }
  $('hTotal').textContent = (v.players[me]?.total ?? 0).toLocaleString('ru');
  renderBoard();
  if (v.phase === 'reveal' && seen !== key) {
    stopTimer(); $('hTimerWrap').hidden = true;
    showReveal(me);
  }
  seen = key;
}

function showReveal(me) {
  const r = v.reveal;
  const mine = r.guesses[me];
  drawReveal(r.answer, r.guesses.map((g, i) => ({ lat: g.lat, lng: g.lng, color: COLORS[i % COLORS.length], name: v.players[i]?.name })));
  $('rDist').textContent = mine?.timeout ? 'Время вышло' : `Промах: ${fmtKm(mine.km)}`;
  $('rScore').textContent = `+${mine?.score ?? 0}`;
  $('rPlace').textContent = r.answer.country;
  const ul = $('rBoard'); ul.hidden = false; ul.replaceChildren();
  r.guesses.map((g, i) => ({ g, i })).sort((a, b) => b.g.score - a.g.score).forEach(({ g, i }) =>
    ul.append(el('li', {}, sw(i), el('span', { className: 'nm', textContent: v.players[i].name }),
      el('span', { className: 'km', textContent: g.timeout ? 'нет ответа' : fmtKm(g.km) }), el('span', { className: 'sc', textContent: `+${g.score}` }),
      el('span', { className: 'tot', textContent: v.players[i].total.toLocaleString('ru') }))));
  $('nextBtn').textContent = v.host ? (r.last ? 'Итоги →' : 'Дальше →') : 'Ждём ведущего…';
  $('nextBtn').disabled = !v.host;
  $('result').hidden = false;
}

function renderFinal() {
  if (seen === 'final') return;
  seen = 'final'; stopTimer();
  show('final');
  const me = v.players.findIndex((p) => p.you);
  $('fTag').textContent = `Комната ${v.code} · итоги`;
  $('fTotal').textContent = (v.players[me]?.total ?? 0).toLocaleString('ru');
  $('fMax').textContent = (v.rounds * S.cfg.maxScore).toLocaleString('ru');
  const board = $('fBoard'); board.hidden = false; board.replaceChildren();
  v.players.map((p, i) => ({ p, i })).sort((a, b) => b.p.total - a.p.total).forEach(({ p, i }, place) =>
    board.append(el('li', {}, el('span', { className: 'km', textContent: `${place + 1}.` }), sw(i), el('span', { className: 'nm', textContent: p.name }), el('span', { className: 'tot', textContent: p.total.toLocaleString('ru') }))));
  $('fHint').textContent = 'Комнату можно закрыть — друзья останутся на этом экране, пока не выйдут сами.';
  const list = $('fList'); list.replaceChildren();
  if (!fMap) { fMap = L.map('fMap', { worldCopyJump: true, minZoom: 1, attributionControl: false }); addBase(fMap); }
  fMap.eachLayer((l) => { if (!(l instanceof L.TileLayer)) fMap.removeLayer(l); });
  const pts = [];
  v.final.rounds.forEach((rd, i) => {
    const a = [rd.answer.lat, rd.answer.lng]; pts.push(a);
    L.marker(a, { icon: pinIcon('answer') }).addTo(fMap);
    const g = rd.guesses[me];
    if (g?.lat != null) { const p = [g.lat, g.lng]; pts.push(p); L.polyline([p, a], { color: COLORS[me % COLORS.length], weight: 2, dashArray: '5 7' }).addTo(fMap); L.marker(p, { icon: pinIcon('guess') }).addTo(fMap); }
    list.append(el('li', {}, el('span', { textContent: `${i + 1}. ${rd.answer.country}` }),
      el('span', { className: 's', textContent: g?.timeout ? 'нет ответа' : `${fmtKm(g.km)} · +${g.score}` })));
  });
  setTimeout(() => { fMap.invalidateSize(); fMap.fitBounds(L.latLngBounds(pts).pad(0.2)); }, 50);
  clearInterval(poll); poll = null; // игра закончена, опрос больше не нужен
  try { sessionStorage.removeItem(KEY); } catch {}
}
