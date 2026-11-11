// Главное меню и точка входа
import { $, api, el, S, show, showErr, showLeaderboard, warmMap, kickMap } from './common.js';
import { startSolo } from './solo.js';
import { createRoom, joinRoom, resume } from './room.js';
import './bg.js';

let timeLimit = 0;
const NAME_KEY = 'qw_name';

async function refreshMe() { S.me = await api('/api/me').catch(() => null); renderAuth(); renderRanked(); }
const backHome = () => { show('home'); refreshMe(); };

// выбор времени на раунд (для одиночной игры и комнаты)
function chips(box) {
  for (const t of S.cfg.timeLimits) {
    const b = el('button', { type: 'button', textContent: t ? (t < 60 ? `${t} с` : `${t / 60} мин`) : '∞', title: t ? '' : 'Без лимита' });
    if (t === 0) b.classList.add('on');
    b.onclick = () => { timeLimit = t; [...box.children].forEach((c) => c.classList.toggle('on', c === b)); };
    box.append(b);
  }
}

function renderAuth() {
  const box = $('authBox'); box.replaceChildren();
  if (S.me) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'ic');
    const use = document.createElementNS(NS, 'use'); use.setAttribute('href', '#i-user'); svg.append(use);
    const who = el('span', { className: 'pill-btn who' }); who.append(svg, document.createTextNode(`${S.me.name}${S.me.admin ? ' · админ' : ''}`));
    box.append(who, el('button', { className: 'pill-btn', textContent: 'Выйти', onclick: async () => { await api('/auth/logout', { method: 'POST' }); refreshMe(); } }));
  } else if (S.cfg.quorvox) {
    box.append(el('a', { className: 'pill-btn green', href: '/auth/quorvox', textContent: 'Войти через Quorvox ID' }));
  } else if (S.cfg.dev) {
    box.append(el('a', { className: 'pill-btn', href: '/auth/dev', textContent: 'Dev-вход' }), el('a', { className: 'pill-btn green', href: '/auth/dev?as=admin', textContent: 'Dev-админ' }));
  }
}

function renderRanked() {
  const info = $('rankedInfo');
  if (!S.me) { info.textContent = 'нужен вход'; return; }
  info.textContent = S.me.rating == null ? '2 мин на раунд' : `рейтинг ${S.me.rating.toLocaleString('ru')}`;
}

// окно с вопросом имени и/или кода комнаты; возвращает введённые значения или null
function ask({ title, text, needCode, code = '', action }) {
  return new Promise((resolve) => {
    const guest = !S.me;
    let saved = ''; try { saved = localStorage.getItem(NAME_KEY) || ''; } catch {}
    const name = el('input', { className: 'input', maxLength: 20, placeholder: 'Твоё имя', value: saved, autocomplete: 'nickname' });
    const codeIn = el('input', { className: 'input mono', maxLength: 4, placeholder: 'КОД', value: code, autocomplete: 'off', spellcheck: false });
    const err = el('p', { className: 'err', hidden: true });
    const done = (v) => { $('modal').hidden = true; resolve(v); };
    const form = el('form', { className: 'ask' },
      guest ? el('label', {}, el('span', { className: 'chips-label', textContent: 'Как тебя называть' }), name) : '',
      needCode ? el('label', {}, el('span', { className: 'chips-label', textContent: 'Код комнаты (4 символа)' }), codeIn) : '',
      err,
      el('div', { className: 'row' }, el('button', { className: 'btn primary', type: 'submit', textContent: action }), el('button', { className: 'btn', type: 'button', textContent: 'Отмена', onclick: () => done(null) })));
    form.onsubmit = (e) => {
      e.preventDefault();
      const n = name.value.trim(), c = codeIn.value.trim().toUpperCase();
      if (guest && !n) { err.textContent = 'Введи имя, чтобы друзья видели, кто ты'; err.hidden = false; return name.focus(); }
      if (needCode && c.length !== 4) { err.textContent = 'Код комнаты — 4 символа'; err.hidden = false; return codeIn.focus(); }
      if (guest) { try { localStorage.setItem(NAME_KEY, n); } catch {} }
      done({ name: guest ? n : '', code: c });
    };
    $('modalBody').replaceChildren(el('h2', { textContent: title }), text ? el('p', { className: 'muted', textContent: text }) : '', form);
    $('modal').hidden = false;
    (guest ? name : codeIn).focus();
  });
}

// кнопка меню с блокировкой на время запроса
async function busy(btn, label, fn) {
  const span = btn.querySelector('span'); const old = span.textContent;
  btn.disabled = true; span.textContent = label; showErr('');
  try { await fn(); } catch (e) { showErr(e.message); show('home'); } finally { btn.disabled = false; span.textContent = old; }
}

async function openJoin(code = '') {
  const r = await ask({ title: 'Войти в комнату', text: 'Код тебе пришлёт тот, кто создал комнату.', needCode: true, code, action: 'Войти' });
  if (r) busy($('joinBtn'), 'Захожу…', () => joinRoom(r.code, r.name, backHome));
}

// выбор формата рейтинговой игры: соло или дуэль с ботом
function chooseRanked() {
  const pick = (mode) => { $('modal').hidden = true; busy($('rankedBtn'), 'Ищу места…', () => startSolo({ mode }, refreshMe)); };
  const card = (title, text, mode) => el('button', { className: 'choice', type: 'button', onclick: () => pick(mode) },
    el('b', { textContent: title }), el('span', { textContent: text }));
  $('modalBody').replaceChildren(
    el('h2', { textContent: 'Рейтинговый режим' }),
    el('p', { className: 'muted', textContent: '5 раундов по 2 минуты. Очки в обоих форматах идут в твой рейтинг.' }),
    el('div', { className: 'choices' },
      card('Одиночный', 'Играешь сам, правила одинаковые для всех.', 'ranked'),
      card('Дуэль', 'Те же места, что и у соперника-бота. Чем выше твой рейтинг, тем точнее играет бот. Побеждает тот, у кого больше очков.', 'duel')),
    el('button', { className: 'btn', type: 'button', textContent: 'Отмена', onclick: () => { $('modal').hidden = true; } }));
  $('modal').hidden = false;
}

(async function init() {
  S.cfg = await api('/api/config');
  chips($('timeOpts'));
  await refreshMe();
  warmMap(); // заранее подгружаем стиль и тайлы карты, чтобы миникарта открывалась сразу

  $('lbBtn').onclick = $('dockLb').onclick = $('fLbBtn').onclick = showLeaderboard;
  $('againBtn').onclick = backHome;
  $('modal').onclick = (e) => { if (e.target === $('modal')) $('modal').hidden = true; };
  // кнопка «увеличить карту» и Esc
  $('expandBtn').onclick = () => { const b = $('mini').classList.toggle('big'); $('expandBtn').textContent = b ? '⤡' : '⤢'; setTimeout(kickMap, 120); setTimeout(kickMap, 400); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('mini').classList.contains('big')) { $('mini').classList.remove('big'); $('expandBtn').textContent = '⤢'; } });

  $('soloBtn').onclick = () => busy($('soloBtn'), 'Ищу места…', () => startSolo({ mode: 'solo', timeLimit }, refreshMe));
  $('rankedBtn').onclick = () => {
    if (!S.me) { if (S.cfg.quorvox) location.href = '/auth/quorvox'; else if (S.cfg.dev) location.href = '/auth/dev'; return; }
    chooseRanked();
  };
  $('roomBtn').onclick = async () => {
    const r = await ask({ title: 'Играть с друзьями', text: `Комната на ${S.cfg.maxPlayers} человек: одни и те же места, общий счёт. Время на раунд берётся из выбора на главном экране.`, action: 'Создать комнату' });
    if (r) busy($('roomBtn'), 'Создаю…', () => createRoom({ timeLimit, name: r.name }, backHome));
  };
  $('joinBtn').onclick = () => openJoin();

  // ссылка вида /?room=ABCD — сразу предлагаем зайти
  const params = new URLSearchParams(location.search);
  const link = params.get('room');
  if (link) { history.replaceState(null, '', location.pathname); openJoin(link.slice(0, 4).toUpperCase()); }
  else if (params.get('auth') === 'error') showErr('Не получилось войти через Quorvox ID, попробуй ещё раз');
  else await resume(backHome); // перезагрузил страницу посреди игры — возвращаемся

  // плоскую панораму листаем перетаскиванием мышью (на телефоне работает обычная прокрутка пальцем)
  const box = $('flatPano'); let down = false, x0 = 0, s0 = 0;
  box.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') return; down = true; x0 = e.clientX; s0 = box.scrollLeft; box.style.cursor = 'grabbing'; box.setPointerCapture(e.pointerId); });
  box.addEventListener('pointermove', (e) => { if (down) box.scrollLeft = s0 - (e.clientX - x0); });
  const up = () => { down = false; box.style.cursor = 'grab'; };
  box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
})();
