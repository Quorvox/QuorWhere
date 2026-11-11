// Живой фон главного меню: тёмная карта медленно «летит» от города к городу.
// Карта векторная (OpenFreeMap, бесплатно и без ключа), подписи убраны, тёмной её делает CSS-фильтр.
// Работает только пока открыто меню. Нет WebGL или включено «меньше анимации» — остаётся тёмный градиент.
import { $, hasWebGL } from './common.js';

const CITIES = [ // [широта, долгота]
  [48.8566, 2.3522], [35.6762, 139.6503], [40.7128, -74.006], [-33.8688, 151.2093], [51.5072, -0.1276], [55.7558, 37.6173],
  [-22.9068, -43.1729], [25.2048, 55.2708], [1.3521, 103.8198], [41.9028, 12.4964], [52.52, 13.405], [19.4326, -99.1332],
  [-33.9249, 18.4241], [37.5665, 126.978], [28.6139, 77.209], [59.3293, 18.0686], [41.0082, 28.9784], [-34.6037, -58.3816],
  [45.5017, -73.5673], [34.0522, -118.2437], [13.7563, 100.5018], [30.0444, 31.2357], [64.1466, -21.9426], [-41.2866, 174.7756],
];

let map, timer, running = false, loading = false, i = Math.floor(Math.random() * CITIES.length);
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
const lngLat = (c) => [c[1], c[0]];

function fly() {
  if (!running || !map) return;
  i = (i + 1 + Math.floor(Math.random() * 5)) % CITIES.length;
  map.flyTo({ center: lngLat(CITIES[i]), zoom: 3.5 + Math.random() * 2.5, duration: 10000, curve: 1.2, essential: true });
  timer = setTimeout(fly, 14000);
}

async function start() {
  if (running || !hasWebGL || !window.maplibregl) return;
  running = true;
  if (!map && !loading) {
    loading = true;
    try {
      const st = await (await fetch('https://tiles.openfreemap.org/styles/positron', { signal: AbortSignal.timeout(10000) })).json();
      st.layers = st.layers.filter((l) => l.type !== 'symbol'); // без подписей: фон должен быть тихим
      map = new maplibregl.Map({ container: 'bgMap', style: st, center: lngLat(CITIES[i]), zoom: 4.5, interactive: false, attributionControl: false, fadeDuration: 400 });
      const show = () => $('bgMap').classList.add('on');
      map.once('render', () => setTimeout(show, 600)); // первый кадр нарисован — плавно показываем
      setTimeout(show, 6000);
    } catch { loading = false; running = false; return; }
    loading = false;
  }
  map?.resize();
  if (running && !calm) timer = setTimeout(fly, 2500);
}
function stop() { running = false; clearTimeout(timer); try { map?.stop(); } catch {} }

document.addEventListener('screen', (e) => { if (e.detail === 'home') start(); else stop(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else if (!$('home').hidden) start(); });
if (!$('home').hidden) start();
