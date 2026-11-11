// Адрес по координатам для админской подсказки. Nominatim (OSM): 1 запрос/сек, свой User-Agent, кэш.
import { countryName } from './locations.js';

const cache = new Map();
let last = 0;

export async function reverse(lat, lng, cc) {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (cache.has(key)) return cache.get(key);

  const wait = last + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();

  const u = new URL('https://nominatim.openstreetmap.org/reverse');
  u.search = new URLSearchParams({ format: 'jsonv2', lat, lon: lng, zoom: '18', addressdetails: '1', 'accept-language': 'ru' }).toString();
  let res = { country: countryName(cc), region: '', city: '', street: '', house: '', full: '' };
  try {
    const r = await fetch(u, { headers: { 'User-Agent': 'quorwhere-portfolio/1.0 (admin hint)' }, signal: AbortSignal.timeout(6000) });
    if (r.ok) {
      const j = await r.json(), a = j.address || {};
      res = {
        country: a.country || res.country,
        region: a.state || a.region || a.county || '',
        city: a.city || a.town || a.village || a.municipality || a.suburb || '',
        street: a.road || a.pedestrian || a.footway || a.path || '',
        house: a.house_number || '',
        full: j.display_name || '',
      };
    }
  } catch { /* без адреса тоже ок — координаты и страна останутся */ }
  if (cache.size > 500) cache.clear();
  cache.set(key, res);
  return res;
}
