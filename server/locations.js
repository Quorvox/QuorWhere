// Где брать места для раундов.
// Берём случайный город из списка, сдвигаем точку на несколько км и просим Google
// найти ближайшую панораму (Street View Metadata API — бесплатный, ничего не списывает).
// Ответ (координаты и pano_id) хранится только на сервере.
import { randomInt } from 'node:crypto';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

// [страна, город, широта, долгота]
const SEEDS = [
  ['US', 'New York', 40.73, -73.99], ['US', 'Los Angeles', 34.05, -118.24], ['US', 'Chicago', 41.88, -87.63],
  ['US', 'Seattle', 47.61, -122.33], ['US', 'Miami', 25.76, -80.19], ['US', 'Denver', 39.74, -104.99],
  ['US', 'Austin', 30.27, -97.74], ['US', 'Anchorage', 61.22, -149.9],
  ['CA', 'Toronto', 43.65, -79.38], ['CA', 'Vancouver', 49.28, -123.12], ['CA', 'Calgary', 51.05, -114.07],
  ['MX', 'Mexico City', 19.43, -99.13], ['MX', 'Guadalajara', 20.67, -103.35],
  ['BR', 'São Paulo', -23.55, -46.63], ['BR', 'Rio de Janeiro', -22.91, -43.17], ['BR', 'Brasília', -15.79, -47.88], ['BR', 'Porto Alegre', -30.03, -51.23],
  ['AR', 'Buenos Aires', -34.6, -58.38], ['AR', 'Córdoba', -31.42, -64.18], ['AR', 'Mendoza', -32.89, -68.84],
  ['CL', 'Santiago', -33.45, -70.67], ['CL', 'Punta Arenas', -53.16, -70.91],
  ['CO', 'Bogotá', 4.71, -74.07], ['CO', 'Medellín', 6.24, -75.58],
  ['PE', 'Lima', -12.05, -77.04], ['PE', 'Cusco', -13.53, -71.97],
  ['UY', 'Montevideo', -34.9, -56.16], ['EC', 'Quito', -0.18, -78.47], ['BO', 'La Paz', -16.5, -68.15],
  ['PY', 'Asunción', -25.26, -57.58], ['CR', 'San José', 9.93, -84.08], ['PA', 'Panama City', 8.98, -79.52],
  ['GT', 'Guatemala City', 14.63, -90.51], ['DO', 'Santo Domingo', 18.49, -69.93],
  ['GB', 'London', 51.51, -0.13], ['GB', 'Edinburgh', 55.95, -3.19], ['GB', 'Manchester', 53.48, -2.24],
  ['IE', 'Dublin', 53.35, -6.26],
  ['FR', 'Paris', 48.86, 2.35], ['FR', 'Lyon', 45.76, 4.84], ['FR', 'Marseille', 43.3, 5.37], ['FR', 'Toulouse', 43.6, 1.44],
  ['ES', 'Madrid', 40.42, -3.7], ['ES', 'Barcelona', 41.39, 2.17], ['ES', 'Sevilla', 37.39, -5.98],
  ['PT', 'Lisbon', 38.72, -9.14], ['PT', 'Porto', 41.15, -8.61],
  ['IT', 'Rome', 41.9, 12.5], ['IT', 'Milan', 45.46, 9.19], ['IT', 'Naples', 40.85, 14.27], ['IT', 'Palermo', 38.12, 13.36],
  ['DE', 'Berlin', 52.52, 13.4], ['DE', 'München', 48.14, 11.58], ['DE', 'Hamburg', 53.55, 9.99], ['DE', 'Köln', 50.94, 6.96],
  ['NL', 'Amsterdam', 52.37, 4.9], ['BE', 'Brussels', 50.85, 4.35], ['CH', 'Zürich', 47.37, 8.54], ['AT', 'Wien', 48.21, 16.37],
  ['PL', 'Warszawa', 52.23, 21.01], ['PL', 'Kraków', 50.06, 19.94], ['CZ', 'Praha', 50.08, 14.44], ['HU', 'Budapest', 47.5, 19.04],
  ['RO', 'București', 44.43, 26.1], ['BG', 'Sofia', 42.7, 23.32], ['GR', 'Athens', 37.98, 23.73],
  ['TR', 'Istanbul', 41.01, 28.98], ['TR', 'Ankara', 39.93, 32.86],
  ['SE', 'Stockholm', 59.33, 18.07], ['NO', 'Oslo', 59.91, 10.75], ['NO', 'Tromsø', 69.65, 18.96],
  ['FI', 'Helsinki', 60.17, 24.94], ['DK', 'København', 55.68, 12.57], ['IS', 'Reykjavík', 64.15, -21.94],
  ['EE', 'Tallinn', 59.44, 24.75], ['LV', 'Rīga', 56.95, 24.11], ['LT', 'Vilnius', 54.69, 25.28],
  ['UA', 'Kyiv', 50.45, 30.52], ['UA', 'Lviv', 49.84, 24.03],
  ['RU', 'Moscow', 55.76, 37.62], ['RU', 'Saint Petersburg', 59.93, 30.34], ['RU', 'Novosibirsk', 55.03, 82.92], ['RU', 'Vladivostok', 43.12, 131.89],
  ['RS', 'Beograd', 44.79, 20.45], ['HR', 'Zagreb', 45.81, 15.98], ['SK', 'Bratislava', 48.15, 17.11],
  ['SI', 'Ljubljana', 46.06, 14.51], ['MK', 'Skopje', 42.0, 21.43], ['AL', 'Tirana', 41.33, 19.82],
  ['IL', 'Tel Aviv', 32.09, 34.78], ['JO', 'Amman', 31.95, 35.93], ['AE', 'Dubai', 25.2, 55.27],
  ['GE', 'Tbilisi', 41.72, 44.79], ['AM', 'Yerevan', 40.18, 44.51], ['KZ', 'Almaty', 43.24, 76.89],
  ['IN', 'Mumbai', 19.08, 72.88], ['IN', 'Delhi', 28.61, 77.21], ['IN', 'Bengaluru', 12.97, 77.59], ['IN', 'Kolkata', 22.57, 88.36],
  ['TH', 'Bangkok', 13.76, 100.5], ['TH', 'Chiang Mai', 18.79, 98.99], ['MY', 'Kuala Lumpur', 3.14, 101.69],
  ['SG', 'Singapore', 1.35, 103.82], ['ID', 'Jakarta', -6.2, 106.85], ['ID', 'Denpasar', -8.65, 115.22],
  ['PH', 'Manila', 14.6, 120.98], ['KH', 'Phnom Penh', 11.56, 104.92], ['LK', 'Colombo', 6.93, 79.86],
  ['JP', 'Tokyo', 35.68, 139.69], ['JP', 'Osaka', 34.69, 135.5], ['JP', 'Sapporo', 43.06, 141.35], ['JP', 'Fukuoka', 33.59, 130.4],
  ['KR', 'Seoul', 37.57, 126.98], ['KR', 'Busan', 35.18, 129.08], ['TW', 'Taipei', 25.03, 121.57], ['HK', 'Hong Kong', 22.32, 114.17],
  ['MN', 'Ulaanbaatar', 47.89, 106.91],
  ['AU', 'Sydney', -33.87, 151.21], ['AU', 'Melbourne', -37.81, 144.96], ['AU', 'Perth', -31.95, 115.86],
  ['AU', 'Brisbane', -27.47, 153.03], ['AU', 'Darwin', -12.46, 130.84],
  ['NZ', 'Auckland', -36.85, 174.76], ['NZ', 'Christchurch', -43.53, 172.64],
  ['ZA', 'Cape Town', -33.92, 18.42], ['ZA', 'Johannesburg', -26.2, 28.05], ['ZA', 'Durban', -29.86, 31.02],
  ['NG', 'Lagos', 6.52, 3.38], ['KE', 'Nairobi', -1.29, 36.82], ['GH', 'Accra', 5.6, -0.19], ['SN', 'Dakar', 14.72, -17.47],
  ['TN', 'Tunis', 36.81, 10.18], ['BW', 'Gaborone', -24.65, 25.91], ['UG', 'Kampala', 0.35, 32.58],
  ['RW', 'Kigali', -1.95, 30.06], ['MG', 'Antananarivo', -18.88, 47.51],
];

const regionNames = new Intl.DisplayNames(['ru'], { type: 'region' });
export const countryName = (cc) => { try { return regionNames.of(cc) || cc; } catch { return cc; } };

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const jitter = (km) => (randomInt(-1000, 1001) / 1000) * (km / 111);

const KEY = () => process.env.GOOGLE_SERVER_KEY || process.env.GOOGLE_MAPS_KEY || '';
const MLY = () => process.env.MAPILLARY_TOKEN || '';
const MIN_DATE = Date.parse('2016-01-01');
const MIN_QUALITY = Number(process.env.MLY_MIN_QUALITY || 0.75);
const MIN_PER_TILE = 30;

// кто даёт панорамы: google, mapillary или null (режим без панорам для проверки логики)
export const provider = () => (KEY() && process.env.GOOGLE_MAPS_KEY ? 'google' : MLY() ? 'mapillary' : null);

// Mapillary: берём тайл покрытия (z14, ~2,4 км) с точками снимков и выбираем среди хороших 360°-панорам.
// Graph API по bbox для этого неудобен (то пусто, то «слишком много данных»), тайлы стабильнее.
const tileXY = (lat, lng, z) => {
  const n = 2 ** z, r = (lat * Math.PI) / 180;
  return [Math.floor(((lng + 180) / 360) * n), Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)];
};
async function findMapillary(lat, lng) {
  const z = 14, [x, y] = tileXY(lat, lng, z);
  const r = await fetch(`https://tiles.mapillary.com/maps/vtp/mly1_public/2/${z}/${x}/${y}?access_token=${encodeURIComponent(MLY())}`, { signal: AbortSignal.timeout(15000) });
  if (r.status === 401 || r.status === 403) throw new Error('Mapillary: токен не принят');
  if (!r.ok) throw new Error(`Mapillary: HTTP ${r.status}`);
  const layer = new VectorTile(new PbfReader(new Uint8Array(await r.arrayBuffer()))).layers.image;
  if (!layer) return null;
  const good = [];
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i), p = f.properties;
    // 360°, не старше 2016 года, нормальное качество (оценка 0..1)
    if (p.is_pano && p.captured_at > MIN_DATE && (p.quality_score ?? 0) >= MIN_QUALITY) good.push(f);
  }
  if (good.length < MIN_PER_TILE) return null; // мало хороших снимков — скорее всего окраина или глушь
  // часть снимков из тайлов закрыта или удалена: проверяем, что API реально отдаёт снимок
  const cand = shuffle(good).slice(0, 6);
  const checks = await Promise.all(cand.map((f) => readable(f.properties.id)));
  const i = checks.findIndex(Boolean);
  if (i < 0) return null;
  const f = cand[i];
  const [lo, la] = f.toGeoJSON(x, y, z).geometry.coordinates;
  return { lat: la, lng: lo, pano: String(f.properties.id) };
}

async function readable(id) {
  try {
    const r = await fetch(`https://graph.mapillary.com/${id}?access_token=${encodeURIComponent(MLY())}&fields=id,thumb_2048_url`, { signal: AbortSignal.timeout(8000) });
    return r.ok;
  } catch { return false; }
}

// ближайшая наружная панорама к точке. null — не нашли
async function findPano(lat, lng) {
  const u = new URL('https://maps.googleapis.com/maps/api/streetview/metadata');
  u.search = new URLSearchParams({ location: `${lat},${lng}`, radius: '20000', source: 'outdoor', key: KEY() }).toString();
  const r = await fetch(u, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`Street View metadata: HTTP ${r.status}`);
  const j = await r.json();
  if (j.status === 'ZERO_RESULTS' || j.status === 'NOT_FOUND') return null;
  if (j.status !== 'OK') throw new Error(`Street View metadata: ${j.status}${j.error_message ? ' — ' + j.error_message : ''}`);
  return { lat: j.location.lat, lng: j.location.lng, pano: j.pano_id };
}

// один кандидат: точка рядом с городом → ближайшая нормальная панорама (или null)
async function tryLocation([cc, , slat, slng], prov) {
  const km = prov === 'google' ? 12 : 4; // у Mapillary держимся ближе к центру
  const lat = slat + jitter(km), lng = slng + jitter(km) / Math.max(0.2, Math.cos((slat * Math.PI) / 180));
  if (!prov) return { lat: +lat.toFixed(6), lng: +lng.toFixed(6), pano: null, cc }; // режим без ключей: панорамы не будет
  const find = prov === 'google' ? findPano : findMapillary;
  const p = await find(lat, lng).catch((e) => { if (/REQUEST_DENIED|OVER_QUERY|UNKNOWN_ERROR|HTTP|токен/.test(e.message)) throw e; return null; });
  return p && { ...p, cc };
}

// Запас готовых мест: подбор живьём занимает 10–20 с, а из запаса игра стартует сразу.
// Запас пополняется в фоне; каждое место отдаётся один раз.
const POOL_MAX = 60;
const pool = [];
let refilling = false;
export async function refill() {
  const prov = provider();
  if (refilling || !prov || pool.length >= POOL_MAX) return;
  refilling = true;
  try {
    const found = await Promise.all(shuffle([...SEEDS]).slice(0, 8).map((s) => tryLocation(s, prov).catch(() => null)));
    for (const x of found) if (x) pool.push(x);
  } finally { refilling = false; }
}
if (provider()) { refill(); setInterval(refill, 10_000).unref(); }
export const poolSize = () => pool.length;

// n раундов, страны в одной игре разные: сначала из запаса, недостающее добираем живьём
export async function makeRounds(n) {
  const prov = provider();
  const out = [], used = new Set();
  for (const x of shuffle([...pool])) {
    if (out.length >= n) break;
    if (used.has(x.cc)) continue;
    out.push(x); used.add(x.cc); pool.splice(pool.indexOf(x), 1);
  }
  if (out.length >= n) { refill(); return out; }

  const seeds = shuffle([...SEEDS]);
  let i = 0;
  while (out.length < n && i < seeds.length) {
    const batch = [], inBatch = new Set();
    while (batch.length < n - out.length + 3 && i < seeds.length) {
      const seed = seeds[i++];
      if (used.has(seed[0]) || inBatch.has(seed[0])) continue;
      inBatch.add(seed[0]); batch.push(seed);
    }
    const found = await Promise.all(batch.map((s) => tryLocation(s, prov)));
    for (const x of found) if (x && out.length < n && !used.has(x.cc)) { out.push(x); used.add(x.cc); }
  }
  if (out.length < n) throw new Error('Не удалось подобрать места, попробуй ещё раз');
  return out;
}
