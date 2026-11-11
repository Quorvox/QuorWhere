# QuorWhere 🌍

**GeoGuessr-style game: you are dropped at a random place on Earth, look around the street-level panorama and mark where you are on the map.** Solo, ranked and multiplayer rooms for up to 5 friends. Free, no Google keys, no credit card.

**Live demo:** https://where.quorvox.ru · Made by [Quorvox_team](https://quorvox.github.io/)

> 🇷🇺 *Кратко по-русски:* игра «угадай, где ты» по панорамам улиц. Режимы: одиночный, рейтинговый (вход через OIDC, рейтинг = среднее последних 10 игр) и комнаты до 5 человек. Панорамы — Mapillary, карты — OpenFreeMap (подписи на русском). Всё бесплатно, ключи Google не нужны. Запуск и настройка — ниже.

## Features

- **3 modes:** solo (any time limit), ranked (5 rounds × 2 min, same rules for everyone, rating = average of your last 10 games), friends rooms (up to 5 players, same places, shared scoreboard, host controls the rounds).
- **Fair play by design:** the correct answer lives only on the server and is sent to the client *after* the guess. Scoring and round timers are validated server-side; rooms reveal answers only when the round is over.
- **Free panoramas:** places are picked from [Mapillary](https://www.mapillary.com) coverage tiles (360° images only, recent, quality-filtered, readable via API) near big cities worldwide; one country per round.
- **Resilient viewer:** if the 3D viewer can't load (WebGL off, tracking protection blocks Meta's CDN), the server proxies the image and a lightweight 360° viewer ([Pannellum](https://pannellum.org)) takes over. A help dialog explains what to fix, and `/diag.html` runs a self-check.
- **Maps with Russian labels:** vector tiles from [OpenFreeMap](https://openfreemap.org) rendered with [MapLibre GL](https://maplibre.org) inside [Leaflet](https://leafletjs.com); a slowly flying dark map as the menu background.
- **OIDC login:** "Sign in with Quorvox ID" (standard OpenID Connect code flow with PKCE; any OIDC provider with discovery works).
- **Admin helper (for testing):** a ⋮ button that shows the answer (country, region, city, street, coordinates). Visible and usable only for accounts listed in `ADMIN_QUORVOX_IDS`.
- **GDPR-minded:** self-hosted fonts, consent dialog before third-party imagery loads, no analytics or ad cookies, privacy/imprint page templates included.

## Stack

Node.js 22+ · Express 5 · built-in `node:sqlite` (no native deps) · vanilla JS ES modules (no build step) · Leaflet + MapLibre GL · mapillary-js · Pannellum · jose (OIDC) · pm2 + nginx for deployment.

## Quick start

```bash
git clone https://github.com/Quorvox/QuorWhere.git
cd QuorWhere
npm install
cp .env.example .env      # then fill it in (see below)
npm start                 # http://localhost:3020
npm test                  # end-to-end tests, no keys required
```

Without any keys the game still starts in a "no panoramas" mode, which is enough to try the whole game loop (maps, scoring, rooms). Set `DEV_LOGIN=1` in `.env` to get local test logins (`/auth/dev`, `/auth/dev?as=admin`); this is ignored in production.

## Configuration (`.env`)

| Variable | What for |
|---|---|
| `PORT`, `PUBLIC_URL` | Port (default 3020) and the public base URL, used for OIDC redirects and secure cookies |
| `MAPILLARY_TOKEN` | **Client token** of your Mapillary app (free). Get one: [mapillary.com/dashboard/developers](https://www.mapillary.com/dashboard/developers) → *Register application* → enable the **READ** scope → copy the *Access Token* (`MLY\|…`). Not the *Client secret*! |
| `GOOGLE_MAPS_KEY`, `GOOGLE_SERVER_KEY` | Optional alternative to Mapillary: Google Street View (needs a billing account). Browser key (Maps JavaScript API, restrict by referrer) and server key (Street View Static API, restrict by IP) |
| `QUORVOX_ISSUER`, `QUORVOX_CLIENT_ID`, `QUORVOX_CLIENT_SECRET` | OIDC provider for login. Redirect URI to register: `<PUBLIC_URL>/auth/quorvox/callback` |
| `ADMIN_QUORVOX_IDS` | Comma-separated account ids (`QV-xxxxxxxx` or OIDC `sub`) allowed to use the admin answer helper |
| `TILES_URL` | Raster fallback tiles for browsers without WebGL (default: OpenStreetMap; respect its [tile policy](https://operations.osmfoundation.org/policies/tiles/) or use your own provider) |
| `MLY_MIN_QUALITY` | Minimum Mapillary `quality_score` for picked images (default `0.75`) |
| `DEV_LOGIN` | `1` enables fake logins for local development only |

Secrets are never committed: `.env`, `ecosystem.config.cjs` and `data/` are in `.gitignore`.

## Deploy (VPS)

See [`deploy/`](deploy/): an nginx site config and a pm2 ecosystem example.

```bash
# on the server
git clone https://github.com/Quorvox/QuorWhere.git /opt/quorwhere && cd /opt/quorwhere
npm ci --omit=dev
cp deploy/ecosystem.config.example.cjs ecosystem.config.cjs   # fill in the values, chmod 600
pm2 start ecosystem.config.cjs && pm2 save
# nginx: copy deploy/nginx.conf, then: certbot --nginx -d your.domain
```

## How it works

- `server/locations.js` — picks a random big city, jitters the point, reads the Mapillary vector tile around it, keeps good 360° panoramas, verifies the image is readable via API, and keeps a warm pool so a game starts instantly.
- `server/index.js` — solo/ranked games, scoring (haversine + exponential falloff, max 5000), leaderboard, image proxy (`/api/pano-img/:id`, only for the requester's *current* round), client error reports.
- `server/rooms.js` — in-memory rooms (4-letter code, 5 players, host-driven rounds, polling every ~1.2 s).
- `public/js/` — `main.js` (menu), `solo.js`, `room.js`, `common.js` (maps, panorama, timers), `bg.js` (menu background).

## Legal pages (important if you host it publicly)

`public/impressum.html` and `public/datenschutz.html` are **templates**: replace every highlighted placeholder with your real details and review the text for your setup. For sites aimed at users in Germany an imprint (Impressum) and a privacy policy (Datenschutz) are mandatory. This is not legal advice.

## Data sources & attribution

- Street-level imagery: [Mapillary](https://www.mapillary.com), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Authors are credited in the viewer.
- Map data: [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL) via [OpenFreeMap](https://openfreemap.org) / [OpenMapTiles](https://www.openmaptiles.org/).
- Address lookup for the admin helper: [Nominatim](https://nominatim.org) (1 request/second, cached, only for admins).

## Known limitations

- Rooms live in memory: a server restart closes them.
- Panorama quality depends on Mapillary crowd-sourcing (some images are dash-cam shots).
- The 3D viewer needs WebGL; the fallback viewer lets you look around but not walk.
- MapLibre GL 4.x is pinned (UMD build required by the Leaflet plugin); `npm audit` flags an XSS issue in its popup sanitizer, which this app does not use (no popups, no untrusted HTML). Moving to 6.x needs an ESM bundle step.

## License

[MIT](LICENSE) © Quorvox_team
