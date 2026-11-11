// Общее для всех режимов: запросы, карта догадки, панорама, таймер, рейтинг, админская подсказка.
export const $ = (id) => document.getElementById(id);
export const api = async (url, opts = {}) => {
  const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Ошибка сервера');
  return j;
};
export const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
export const fmtKm = (km) => (km < 1 ? `${Math.round(km * 1000)} м` : km < 100 ? `${km.toFixed(1)} км` : `${Math.round(km).toLocaleString('ru')} км`);
export const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
export const COLORS = ['#f4f4f5', '#3ddc84', '#5aa9ff', '#ffb454', '#ff7ab6'];

// cfg — настройки с сервера, me — текущий игрок, map/layer — карта догадки
export const S = { cfg: null, me: null, map: null, layer: null, onMapClick: null, panorama: null, mly: null };

export function show(screen) {
  for (const s of ['home', 'lobby', 'game', 'final']) $(s).hidden = s !== screen;
  document.body.style.overflow = screen === 'game' ? 'hidden' : '';
  window.scrollTo(0, 0);
  document.dispatchEvent(new CustomEvent('screen', { detail: screen }));
}

// ---------- согласие на внешний сервис панорам (GDPR: ему уходит IP) ----------
export function consent() {
  try { if (localStorage.getItem('qw_pano_ok') === '1') return Promise.resolve(true); } catch {}
  if (!S.cfg.provider) return Promise.resolve(true);
  const who = S.cfg.provider === 'google' ? 'Google Street View' : 'Mapillary (Meta)';
  return new Promise((resolve) => {
    const done = (ok) => { $('modal').hidden = true; if (ok) { try { localStorage.setItem('qw_pano_ok', '1'); } catch {} } resolve(ok); };
    $('modalBody').replaceChildren(
      el('h2', { textContent: `Панорамы: ${who}` }),
      el('p', { className: 'muted', textContent: `Улицы показывает ${who}. При загрузке снимков этот сервис получает твой IP-адрес и может ставить свои cookie. Продолжить?` }),
      el('button', { className: 'btn primary', textContent: 'Ок, играем', onclick: () => done(true) }),
      el('button', { className: 'btn', textContent: 'Отмена', onclick: () => done(false) }),
    );
    $('modal').hidden = false;
  });
}

// ---------- WebGL нужен и панораме Mapillary, и векторной карте ----------
export const hasWebGL = (() => {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
})();

// ---------- панорама: Mapillary или Google ----------
let panoTimer;
const FLAT_PARAM = new URLSearchParams(location.search).get('flat');
const FORCE_FLAT = FLAT_PARAM !== null; // ?flat — упрощённый режим принудительно (для проверки)
function panoStatus(msg, { retry } = {}) {
  const n = $('panoStatus');
  n.hidden = !msg;
  n.replaceChildren();
  if (!msg) return;
  n.append(el('div', { className: 'ps-text', textContent: msg }));
  if (retry) n.append(el('button', { className: 'btn', textContent: retry.label, onclick: retry.fn }));
}
// колбэк, который игра ставит, чтобы заменить нерабочий снимок (только одиночная игра)
S.onPanoFail = null;

// отчёт об ошибке серверу: почему панорама не показалась (браузер, WebGL, текст ошибки)
function report(kind, msg) {
  try {
    fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ kind, msg: String(msg || '').slice(0, 300), webgl: hasWebGL, ua: navigator.userAgent.slice(0, 200), provider: S.cfg?.provider }) });
  } catch {}
}

// Окно помощи: показываем один раз за вкладку, когда 3D-панорама не запустилась
function helpModal(why) {
  try { if (sessionStorage.getItem('qw_help')) return; sessionStorage.setItem('qw_help', '1'); } catch {}
  const ua = navigator.userAgent;
  const br = /YaBrowser/.test(ua) ? 'yandex' : /OPR\//.test(ua) ? 'opera' : /Edg\//.test(ua) ? 'edge' : /Firefox\//.test(ua) ? 'firefox' : /Chrome\//.test(ua) ? 'chrome' : 'other';
  const steps = {
    edge: ['Открой меню «⋯» → Настройки → Система и производительность.', 'Включи «Использовать графическое ускорение, если оно доступно».', 'Перезапусти Edge и открой сайт снова.'],
    chrome: ['Открой Настройки → Система.', 'Включи «Использовать аппаратное ускорение (если доступно)».', 'Нажми «Перезапустить» и открой сайт снова.'],
    firefox: ['Открой Настройки → Основные → Производительность.', 'Сними «Использовать рекомендуемые настройки производительности» и включи «Использовать аппаратное ускорение».', 'Перезапусти Firefox.'],
    opera: ['Открой Настройки → Браузер → Система.', 'Включи «Использовать аппаратное ускорение, если доступно».', 'Перезапусти Opera.'],
    yandex: ['Открой Настройки → Система.', 'Включи «Использовать аппаратное ускорение, если возможно».', 'Перезапусти браузер.'],
    other: ['В настройках браузера найди пункт про аппаратное (графическое) ускорение и включи его.', 'Перезапусти браузер и открой сайт снова.'],
  }[br];
  const noGl = why === 'нет WebGL';
  $('modalBody').replaceChildren(
    el('h2', { textContent: '3D-панорама не запустилась' }),
    el('p', { className: 'muted', textContent: noGl ? 'В твоём браузере выключен WebGL — на нём работает объёмная панорама. Пока можешь играть в упрощённом режиме: картинка листается мышью, но ходить по улице нельзя.' : 'Объёмная панорама не загрузилась. Чаще всего её блокирует расширение (блокировщик рекламы или приватности) или выключено аппаратное ускорение. Пока играй в упрощённом режиме: картинка листается мышью.' }),
    el('div', { className: 'chips-label', textContent: 'Как включить' }),
    el('ol', { className: 'help-list' }, ...steps.map((t) => el('li', { textContent: t }))),
    el('ol', { className: 'help-list' },
      el('li', { textContent: 'Проверь, включён ли WebGL: открой get.webgl.org — должен быть зелёный текст.' }),
      el('li', { textContent: 'Отключи расширения-блокировщики для этого сайта и обнови страницу (F5).' }),
      el('li', { textContent: 'Не помогло — попробуй другой браузер или обнови драйвер видеокарты.' })),
    el('button', { className: 'btn primary', textContent: 'Понятно, играть так', onclick: () => { $('modal').hidden = true; } }),
    el('a', { className: 'btn', href: 'https://get.webgl.org', target: '_blank', rel: 'noopener', textContent: 'Проверить WebGL ↗' }),
  );
  $('modal').hidden = false;
}

// Запасной режим: картинка снимка берётся через НАШ сервер (а не напрямую у Mapillary), поэтому её не режут
// защита от отслеживания и расширения. С WebGL — 360°-просмотрщик (крутить обзор), без WebGL — плоская лента.
function destroyPann() { try { S.pann?.destroy(); } catch {} S.pann = null; }
async function flatFallback(id, why) {
  report('fallback', why);
  clearTimeout(panoTimer);
  const url = `/api/pano-img/${id}?t=${Date.now() % 100000}`;
  const ok = await new Promise((resolve) => {
    const im = new Image(); im.onload = () => resolve(true); im.onerror = () => resolve(false); im.src = url;
    setTimeout(() => resolve(false), 20000);
  });
  if (!ok) {
    report('fallback-failed', 'картинка через сервер не загрузилась');
    panoStatus('Панорама не загрузилась. Проверь соединение и обнови страницу. Если не поможет — отключи блокировщик рекламы для этого сайта.',
      S.onPanoFail ? { retry: { label: 'Заменить место', fn: () => S.onPanoFail() } } : undefined);
    return;
  }
  panoStatus('');
  $('pano').hidden = true;
  leaveFlat();
  if (hasWebGL && window.pannellum) {
    $('pannView').hidden = false;
    try {
      S.pann = pannellum.viewer('pannView', { type: 'equirectangular', panorama: url, autoLoad: true, showControls: true, compass: false, hfov: 105, minHfov: 50, maxHfov: 120, yaw: Math.random() * 360, mouseZoom: true });
      S.pann.on('error', () => { report('pannellum-error', 'ошибка просмотрщика'); showFlatStrip(url); });
    } catch (e) { report('pannellum-fail', e.message); showFlatStrip(url); }
  } else showFlatStrip(url);
  $('flatNote').hidden = false;
}
function showFlatStrip(url) {
  destroyPann(); $('pannView').hidden = true;
  const box = $('flatPano');
  box.replaceChildren(el('img', { src: url, alt: 'Панорама', draggable: false }));
  box.hidden = false;
  box.scrollLeft = (box.scrollWidth - box.clientWidth) / 2;
}
function leaveFlat() { destroyPann(); $('pannView').hidden = true; $('pannView').replaceChildren(); $('flatPano').hidden = true; $('flatNote').hidden = true; }
function watchLoading(id) {
  clearTimeout(panoTimer);
  panoStatus('Загружаю панораму…');
  panoTimer = setTimeout(() => flatFallback(id, 'таймаут загрузки 3D-просмотрщика'), 9000);
}

let gmapsPromise;
export function loadGoogle() {
  if (!S.cfg.mapsKey) return Promise.resolve(false);
  return (gmapsPromise ||= new Promise((resolve) => {
    window.__gmReady = () => resolve(true);
    const s = el('script', { src: `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(S.cfg.mapsKey)}&callback=__gmReady&loading=async&language=ru`, async: true });
    s.onerror = () => resolve(false);
    document.head.append(s);
  }));
}

export function showPano(pano) {
  if (S.cfg.provider === 'mapillary' && pano && window.mapillary) {
    $('nopano').hidden = true; leaveFlat(); $('pano').hidden = false;
    if (!hasWebGL || FORCE_FLAT) { flatFallback(pano, hasWebGL ? (FLAT_PARAM === 'help' ? 'режим ?flat=help' : 'режим ?flat') : 'нет WebGL'); return; }
    watchLoading(pano);
    try {
      if (!S.mly) {
        S.mly = new mapillary.Viewer({ accessToken: S.cfg.mapillaryToken, container: 'pano', imageId: pano, component: { cover: false } });
        S.mly.on('image', () => { clearTimeout(panoTimer); panoStatus(''); });
      } else S.mly.moveTo(pano).catch((e) => flatFallback(pano, `moveTo: ${e.message}`));
    } catch (e) { flatFallback(pano, `viewer: ${e.message}`); }
    return;
  }
  const ok = !!(pano && window.google?.maps);
  $('nopano').hidden = ok; $('pano').hidden = !ok;
  if (!ok) return;
  const pov = { heading: Math.random() * 360, pitch: 0 };
  if (!S.panorama) {
    S.panorama = new google.maps.StreetViewPanorama($('pano'), {
      pano, addressControl: false, showRoadLabels: false, fullscreenControl: false, enableCloseButton: false,
      motionTracking: false, motionTrackingControl: false, zoomControl: true, panControl: true, pov,
    });
  } else { S.panorama.setPano(pano); S.panorama.setPov(pov); }
  S.panorama.setVisible(true);
}

// ---------- карта догадки ----------
export const pinIcon = (cls, color) => L.divIcon({ className: '', html: `<div class="pin ${cls}"${color ? ` style="background:${color}"` : ''}></div>`, iconSize: [20, 20], iconAnchor: [10, 10] });

const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const VEC_ATTR = '<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/">OpenMapTiles</a> Data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

// Основа карты: векторная (OpenFreeMap) с подписями на русском. Пока грузится или если WebGL нет — обычные растровые тайлы.
let styleP;
function ruStyle() {
  return (styleP ||= fetch('https://tiles.openfreemap.org/styles/liberty', { signal: AbortSignal.timeout(10000) }).then((r) => r.json()).then((st) => {
    const ru = ['coalesce', ['get', 'name:ru'], ['get', 'name:latin'], ['get', 'name']];
    for (const l of st.layers) {
      if (l.layout?.['text-field'] && !/shield|ref/.test(l.id)) l.layout['text-field'] = ru;
    }
    return st;
  }));
}
// Основа карты: векторная (OpenFreeMap) с подписями на русском. Без WebGL векторной карты не будет — берём обычные тайлы OpenStreetMap.
// (Пока рисуется вектор, фон контейнера голубой — как океан, поэтому мигания белым нет.)
// Векторный слой иногда не рисуется, пока карту не «подтолкнуть» (пересчёт размера + сдвиг на 1 пиксель).
// Делаем это сами в нужные моменты, чтобы миникарта не оставалась пустой.
export function kickMap() {
  try {
    S.map.invalidateSize();
    const m = S.gl?.getMaplibreMap();
    m?.resize(); m?.triggerRepaint();
    S.map.panBy([1, 0], { animate: false }); S.map.panBy([-1, 0], { animate: false });
  } catch {}
}
// два лёгких толчка после создания и при смене размера — на случай, если векторный слой не нарисовался сам
export function kickBurst() { setTimeout(kickMap, 400); setTimeout(kickMap, 2000); }
export function addBase(map) {
  if (!(hasWebGL && L.maplibreGL)) {
    L.tileLayer(S.cfg.tiles, { maxZoom: 18, attribution: OSM_ATTR }).addTo(map);
    return;
  }
  ruStyle().then((style) => {
    S.gl = L.maplibreGL({ style, attribution: VEC_ATTR, maxZoom: 18 }).addTo(map);
    kickBurst();
  }).catch(() => L.tileLayer(S.cfg.tiles, { maxZoom: 18, attribution: OSM_ATTR }).addTo(map));
}

// Прогрев: пока игрок в меню, заранее тянем стиль и тайлы мира — миникарта в игре открывается без ожидания.
export function warmMap() {
  if (!hasWebGL) return;
  ruStyle().then(async (st) => {
    const tj = await (await fetch(st.sources.openmaptiles.url)).json();
    const t = tj.tiles?.[0]; if (!t) return;
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) fetch(t.replace('{z}', 2).replace('{x}', x).replace('{y}', y), { priority: 'low' }).catch(() => {});
    for (let x = 1; x < 3; x++) for (let y = 1; y < 3; y++) fetch(t.replace('{z}', 3).replace('{x}', x * 2).replace('{y}', y * 2), { priority: 'low' }).catch(() => {});
  }).catch(() => {});
}

export function initMap() {
  if (S.map) return;
  S.map = L.map('map', { worldCopyJump: true, minZoom: 1, zoomControl: false, attributionControl: true }).setView([25, 10], 2);
  addBase(S.map);
  S.layer = L.layerGroup().addTo(S.map);
  S.map.on('click', (e) => S.onMapClick?.(e.latlng));
  new ResizeObserver(() => { S.map.invalidateSize(); try { S.gl?.getMaplibreMap().resize(); S.gl?.getMaplibreMap().triggerRepaint(); } catch {} }).observe($('map'));
}

// сбросить игровой экран перед новым раундом
export function resetRoundUi({ round, rounds, total }) {
  S.layer.clearLayers();
  S.map.setView([25, 10], 2);
  $('mini').classList.remove('done', 'big');
  $('result').hidden = true; $('rBoard').hidden = true;
  $('guessBtn').disabled = true; $('guessBtn').textContent = 'Поставь точку';
  $('hRound').textContent = round; $('hRounds').textContent = rounds; $('hTotal').textContent = total;
  $('adminMenu').hidden = true; $('hintOut').hidden = true;
  $('adminWrap').hidden = !S.me?.admin;
  kickBurst();
}

// показать правильное место и догадки; guesses: [{lat,lng,color,name}]
export function drawReveal(answer, guesses) {
  const a = [answer.lat, answer.lng], pts = [a];
  L.marker(a, { icon: pinIcon('answer') }).addTo(S.layer);
  for (const g of guesses) {
    if (g.lat == null) continue;
    const p = [g.lat, g.lng]; pts.push(p);
    L.polyline([p, a], { color: g.color, weight: 3, dashArray: '6 8' }).addTo(S.layer);
    const m = L.marker(p, { icon: pinIcon('guess', g.color) }).addTo(S.layer);
    if (g.name) m.bindTooltip(g.name, { permanent: guesses.length > 1, direction: 'top', className: 'pn', offset: [0, -8] });
  }
  $('mini').classList.remove('big'); $('mini').classList.add('done');
  setTimeout(() => { S.map.invalidateSize(); S.map.fitBounds(L.latLngBounds(pts).pad(0.4), { maxZoom: 6 }); }, 220);
}

// ---------- таймер раунда ----------
export function startTimer({ startedAt, limit, serverNow, onEnd }) {
  const skew = serverNow - Date.now();
  $('hTimerWrap').hidden = !limit;
  if (!limit) return () => {};
  let id;
  const tick = () => {
    const left = Math.max(0, Math.ceil((startedAt + limit * 1000 - (Date.now() + skew)) / 1000));
    $('hTimer').textContent = fmtTime(left);
    if (left <= 0) { clearInterval(id); onEnd?.(); }
  };
  tick(); id = setInterval(tick, 250);
  return () => clearInterval(id);
}

// ---------- рейтинг ----------
export async function showLeaderboard() {
  const rows = await api('/api/leaderboard').catch(() => []);
  const body = $('modalBody');
  body.replaceChildren(el('h2', { textContent: 'Рейтинг' }), el('p', { className: 'muted', textContent: 'Средний результат последних 10 рейтинговых игр.' }));
  if (!rows.length) body.append(el('p', { className: 'muted', textContent: 'Пока пусто. Войди через Quorvox ID, сыграй рейтинговую игру и стань первым.' }));
  else {
    const t = el('table', { className: 'lb' });
    rows.forEach((r, i) => t.append(el('tr', {}, el('td', { textContent: i + 1 }), el('td', { textContent: r.name }),
      el('td', { className: 'r', textContent: `${r.games} игр` }), el('td', { className: 'r s', textContent: r.rating.toLocaleString('ru') }))));
    body.append(t);
  }
  body.append(el('button', { className: 'btn', textContent: 'Закрыть', onclick: () => { $('modal').hidden = true; } }));
  $('modal').hidden = false;
}

// ---------- админская подсказка: urlFn() возвращает адрес запроса для текущей игры ----------
export function setupAdmin(urlFn) {
  $('adminBtn').onclick = () => { $('adminMenu').hidden = !$('adminMenu').hidden; };
  $('hintBtn').onclick = async () => {
    const out = $('hintOut');
    out.hidden = false; out.textContent = 'Ищу адрес…';
    try {
      const h = await api(urlFn());
      const rows = [['Страна', h.country], ['Регион', h.region], ['Город', h.city], ['Улица', [h.street, h.house].filter(Boolean).join(', ')],
        ['Координаты', `${h.lat.toFixed(5)}, ${h.lng.toFixed(5)}`], ['Pano ID', h.pano || '—']].filter(([, v]) => v);
      const dl = el('dl');
      rows.forEach(([k, v]) => dl.append(el('dt', { textContent: k }), el('dd', { textContent: v })));
      out.replaceChildren(dl, el('p', {}, el('a', { href: h.map, target: '_blank', rel: 'noopener', textContent: 'Открыть в Google Maps ↗' })));
    } catch (e) { out.textContent = e.message; }
  };
}

export function showErr(msg) { const e = $('homeErr'); e.textContent = msg; e.hidden = !msg; }
