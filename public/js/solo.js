// Одиночная, рейтинговая и дуэльная игра (раунды ведёт сервер, ответы приходят после догадки).
// Дуэль: соперник — бот; его догадки приходят только после твоей, до этого видно лишь «думает… / ответил».
import { $, api, el, S, COLORS, show, consent, loadGoogle, showPano, initMap, addBase, pinIcon, resetRoundUi, drawReveal, startTimer, setupAdmin, fmtKm } from './common.js';

let game, marker, stopTimer = () => {}, stopBotTimer, submitting = false, fMap, onDone = () => {};
let duel = null; // { name, me, opp, oppDone } — состояние табло в дуэли

const sw = (color) => el('i', { className: 'sw', style: `background:${color}` });
const botTag = () => el('span', { className: 'bot-tag', textContent: 'бот', title: 'Соперник — компьютерный бот' });

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

function exit() { stopTimer(); clearTimeout(stopBotTimer); game = null; duel = null; $('roomBoard').hidden = true; show('home'); onDone(); }

// табло дуэли: ты и соперник-бот
function renderDuelBoard() {
  const b = $('roomBoard');
  if (!duel) { b.hidden = true; return; }
  b.hidden = false; b.replaceChildren();
  const row = (color, name, val, isBot) => el('div', {}, sw(color), el('span', { className: 'nm', textContent: name }), isBot ? botTag() : '', el('span', { className: val === '✓' ? 'ok' : 'sc', textContent: val }));
  const guessing = !game?.answered;
  b.append(row(COLORS[0], S.me?.name || 'Ты', guessing ? (game?.answered ? '✓' : '…') : duel.me.toLocaleString('ru'), false),
    row(COLORS[1], duel.name, guessing ? (duel.oppDone ? '✓' : '…') : duel.opp.toLocaleString('ru'), true));
}

function beginRound(g) {
  game = g; marker = null;
  resetRoundUi(g);
  showPano(g.pano);
  stopTimer(); clearTimeout(stopBotTimer);
  if (g.opponent) {
    duel = { name: g.opponent.name, me: g.total, opp: g.opponent.total, oppDone: false };
    // «соперник ответил» появляется в то время, которое выбрал сервер (сама догадка скрыта)
    const wait = Math.max(0, g.opponent.answerAt - (g.serverNow + (Date.now() - g._t0 || 0)));
    stopBotTimer = setTimeout(() => { if (duel) { duel.oppDone = true; renderDuelBoard(); } }, wait);
  } else duel = null;
  renderDuelBoard();
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
  const guesses = [{ lat: r.guess.lat, lng: r.guess.lng, color: COLORS[0], name: r.bot ? (S.me?.name || 'Ты') : undefined }];
  if (r.bot) guesses.push({ lat: r.bot.guess.lat, lng: r.bot.guess.lng, color: COLORS[1], name: r.bot.name });
  drawReveal(r.answer, guesses);
  $('rDist').textContent = r.guess.timeout ? 'Время вышло' : `Промах: ${fmtKm(r.guess.km)}`;
  $('rScore').textContent = `+${r.guess.score}`;
  $('rPlace').textContent = r.answer.country;
  const ul = $('rBoard');
  if (r.bot) {
    duel.me = r.total; duel.opp = r.bot.total;
    ul.hidden = false; ul.replaceChildren();
    [{ c: COLORS[0], n: S.me?.name || 'Ты', g: r.guess, t: r.total, bot: false }, { c: COLORS[1], n: r.bot.name, g: r.bot.guess, t: r.bot.total, bot: true }]
      .sort((a, b) => b.g.score - a.g.score).forEach((x) =>
        ul.append(el('li', {}, sw(x.c), el('span', { className: 'nm', textContent: x.n }), x.bot ? botTag() : '',
          el('span', { className: 'km', textContent: x.g.timeout ? 'нет ответа' : fmtKm(x.g.km) }), el('span', { className: 'sc', textContent: `+${x.g.score}` }), el('span', { className: 'tot', textContent: x.t.toLocaleString('ru') }))));
    renderDuelBoard();
  } else ul.hidden = true;
  $('nextBtn').textContent = r.last ? 'Итоги →' : 'Дальше →'; $('nextBtn').disabled = false;
  $('result').hidden = false;
}

async function nextRound() {
  $('nextBtn').disabled = true;
  try {
    const t0 = Date.now();
    const r = await api(`/api/games/${game.gameId}/next`, { method: 'POST' });
    if (r.finished) return showFinal(r);
    r._t0 = t0;
    beginRound(r);
  } catch (e) { alert(e.message); $('nextBtn').disabled = false; }
}

function showFinal(r) {
  const ranked = game.ranked;
  show('final');
  $('roomBoard').hidden = true; clearTimeout(stopBotTimer);
  $('fTotal').textContent = r.total.toLocaleString('ru');
  $('fMax').textContent = (S.cfg.rounds * S.cfg.maxScore).toLocaleString('ru');
  const board = $('fBoard');
  if (r.duel) {
    const verdict = { win: 'Победа', loss: 'Поражение', draw: 'Ничья' }[r.duel.result];
    $('fTag').textContent = `Дуэль · ${verdict}`;
    $('fHint').textContent = 'Результат учтён в рейтинге. Соперник — компьютерный бот: чем выше твой рейтинг, тем точнее он играет.';
    board.hidden = false; board.replaceChildren();
    [{ c: COLORS[0], n: S.me?.name || 'Ты', t: r.total, bot: false }, { c: COLORS[1], n: r.duel.name, t: r.duel.total, bot: true }]
      .sort((a, b) => b.t - a.t).forEach((x, i) =>
        board.append(el('li', {}, el('span', { className: 'km', textContent: `${i + 1}.` }), sw(x.c), el('span', { className: 'nm', textContent: x.n }), x.bot ? botTag() : '', el('span', { className: 'tot', textContent: x.t.toLocaleString('ru') }))));
  } else {
    $('fTag').textContent = ranked ? 'Рейтинговая игра окончена' : 'Игра окончена';
    board.hidden = true;
    $('fHint').textContent = ranked ? 'Результат учтён в рейтинге.' : (S.me ? 'Это одиночная игра: в рейтинг она не идёт.' : '');
  }
  const list = $('fList'); list.replaceChildren();
  if (!fMap) { fMap = L.map('fMap', { worldCopyJump: true, minZoom: 1, attributionControl: false }); addBase(fMap); }
  fMap.eachLayer((l) => { if (l instanceof L.Marker || l instanceof L.Polyline) fMap.removeLayer(l); }); // базовый слой карты не трогаем
  const pts = [];
  r.rounds.forEach((x, i) => {
    const a = [x.answer.lat, x.answer.lng]; pts.push(a);
    L.marker(a, { icon: pinIcon('answer') }).addTo(fMap);
    if (x.guess.lat != null) { const g = [x.guess.lat, x.guess.lng]; pts.push(g); L.polyline([g, a], { color: '#f4f4f5', weight: 2, dashArray: '5 7' }).addTo(fMap); L.marker(g, { icon: pinIcon('guess') }).addTo(fMap); }
    const mine = `${x.guess.timeout ? 'время вышло' : fmtKm(x.guess.km)} · +${x.guess.score}`;
    list.append(el('li', {}, el('span', { textContent: `${i + 1}. ${x.answer.country}` }),
      el('span', { className: 's', textContent: x.bot ? `ты +${x.guess.score} · ${r.duel.name} +${x.bot.score}` : mine })));
  });
  setTimeout(() => { fMap.invalidateSize(); fMap.fitBounds(L.latLngBounds(pts).pad(0.2)); }, 50);
  stopTimer(); game = null; duel = null; onDone();
}
