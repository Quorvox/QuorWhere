// Одиночная и рейтинговая игра (раунды ведёт сервер, ответы приходят после догадки)
import { $, api, el, S, show, consent, loadGoogle, showPano, initMap, addBase, pinIcon, resetRoundUi, drawReveal, startTimer, setupAdmin, fmtKm } from './common.js';

let game, marker, stopTimer = () => {}, submitting = false, fMap, onDone = () => {};

export async function startSolo({ mode, timeLimit }, done) {
  onDone = done || (() => {});
  if (!(await consent())) return;
  const [g] = await Promise.all([api('/api/games', { method: 'POST', body: { mode, timeLimit } }), loadGoogle()]);
  show('game'); initMap();
  $('roomBoard').hidden = true;
  $('exitBtn').onclick = exit;
  $('guessBtn').onclick = () => submitGuess();
  $('nextBtn').onclick = nextRound;
  S.onMapClick = (ll) => {
    if (!game || game.answered) return;
    if (marker) marker.setLatLng(ll); else marker = L.marker(ll, { icon: pinIcon('guess') }).addTo(S.layer);
    $('guessBtn').disabled = false; $('guessBtn').textContent = 'Угадать';
  };
  setupAdmin(() => `/api/games/${game.gameId}/hint`);
  beginRound(g);
}

function exit() { stopTimer(); game = null; show('home'); onDone(); }

function beginRound(g) {
  game = g; marker = null;
  resetRoundUi(g);
  showPano(g.pano);
  stopTimer();
  stopTimer = startTimer({ startedAt: g.startedAt, limit: g.timeLimit, serverNow: g.serverNow, onEnd: () => { if (!game.answered) submitGuess(true); } });
}

async function submitGuess(timeout = false) {
  if (submitting || !game || game.answered) return;
  const ll = marker?.getLatLng();
  if (!ll && !timeout) return;
  submitting = true; stopTimer();
  try {
    const r = await api(`/api/games/${game.gameId}/guess`, { method: 'POST', body: ll ? { lat: ll.lat, lng: ll.lng } : {} });
    game.answered = true;
    showResult(r);
  } catch (e) { alert(e.message); if (timeout) exit(); }
  finally { submitting = false; }
}

function showResult(r) {
  $('hTotal').textContent = r.total;
  drawReveal(r.answer, [{ lat: r.guess.lat, lng: r.guess.lng, color: '#f4f4f5' }]);
  $('rDist').textContent = r.guess.timeout ? 'Время вышло' : `Промах: ${fmtKm(r.guess.km)}`;
  $('rScore').textContent = `+${r.guess.score}`;
  $('rPlace').textContent = r.answer.country;
  $('nextBtn').textContent = r.last ? 'Итоги →' : 'Дальше →'; $('nextBtn').disabled = false;
  $('result').hidden = false;
}

async function nextRound() {
  $('nextBtn').disabled = true;
  try {
    const r = await api(`/api/games/${game.gameId}/next`, { method: 'POST' });
    if (r.finished) return showFinal(r);
    beginRound(r);
  } catch (e) { alert(e.message); $('nextBtn').disabled = false; }
}

function showFinal(r) {
  const ranked = game.ranked;
  show('final');
  $('fTag').textContent = ranked ? 'Рейтинговая игра окончена' : 'Игра окончена';
  $('fTotal').textContent = r.total.toLocaleString('ru');
  $('fMax').textContent = (S.cfg.rounds * S.cfg.maxScore).toLocaleString('ru');
  $('fBoard').hidden = true;
  $('fHint').textContent = ranked ? 'Результат учтён в рейтинге.' : (S.me ? 'Это одиночная игра: в рейтинг она не идёт.' : '');
  const list = $('fList'); list.replaceChildren();
  if (!fMap) { fMap = L.map('fMap', { worldCopyJump: true, minZoom: 1, attributionControl: false }); addBase(fMap); }
  fMap.eachLayer((l) => { if (!(l instanceof L.TileLayer)) fMap.removeLayer(l); });
  const pts = [];
  r.rounds.forEach((x, i) => {
    const a = [x.answer.lat, x.answer.lng]; pts.push(a);
    L.marker(a, { icon: pinIcon('answer') }).addTo(fMap);
    if (x.guess.lat != null) { const g = [x.guess.lat, x.guess.lng]; pts.push(g); L.polyline([g, a], { color: '#f4f4f5', weight: 2, dashArray: '5 7' }).addTo(fMap); L.marker(g, { icon: pinIcon('guess') }).addTo(fMap); }
    list.append(el('li', {}, el('span', { textContent: `${i + 1}. ${x.answer.country}` }),
      el('span', { className: 's', textContent: `${x.guess.timeout ? 'время вышло' : fmtKm(x.guess.km)} · +${x.guess.score}` })));
  });
  setTimeout(() => { fMap.invalidateSize(); fMap.fitBounds(L.latLngBounds(pts).pad(0.2)); }, 50);
  stopTimer(); game = null; onDone();
}
