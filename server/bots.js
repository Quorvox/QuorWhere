// Боты для дуэлей. Это не нейросети и не «настоящие игроки»: сервер заранее рисует для каждого раунда догадку,
// смещённую от правильного места на нужное расстояние. Чем выше рейтинг человека, тем точнее бот.
import { haversineKm, scoreForDistance, MAX_SCORE } from './scoring.js';

// skill — множитель к «среднему раунду» человека, spread — разброс результатов (больше = нестабильнее)
export const BOTS = [
  { name: 'Nova_Walker', skill: 1.00, spread: 0.30 },
  { name: 'Мария К.',    skill: 0.92, spread: 0.35 },
  { name: 'GeoFox',      skill: 1.08, spread: 0.28 },
  { name: 'Tanya_V',     skill: 0.88, spread: 0.40 },
  { name: 'Karl_B',      skill: 1.04, spread: 0.32 },
  { name: 'Мирон',       skill: 0.96, spread: 0.45 },
  { name: 'SunnyRoute',  skill: 0.84, spread: 0.38 },
  { name: 'Lena_R',      skill: 1.10, spread: 0.25 },
  { name: 'Ivo_Nomad',   skill: 0.94, spread: 0.42 },
  { name: 'Дима Н.',     skill: 1.02, spread: 0.36 },
];

const NEW_PLAYER_ROUND = 2000;          // «средний раунд» для игрока без рейтинга
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());

// сколько очков за раунд бот в среднем набирает против игрока с таким рейтингом (рейтинг = среднее за 5 раундов)
export function expectedRoundScore(rating, skill = 1) {
  const human = rating == null ? NEW_PLAYER_ROUND : rating / 5;
  return clamp(human * 0.97 * skill, 700, 4700);
}

// один раунд бота: целевые очки → расстояние → точка на таком расстоянии от ответа
function sampleScore(mean, spread) {
  if (Math.random() < 0.08) return 80 + Math.random() * 820;                  // иногда бот промахивается сильно
  return clamp(mean * Math.exp(gauss() * spread), 60, MAX_SCORE - 10);
}
const kmForScore = (s) => -1492.7 * Math.log(s / MAX_SCORE);

function destination(lat, lng, km, bearingDeg) {
  const R = 6371, d = km / R, b = (bearingDeg * Math.PI) / 180, p1 = (lat * Math.PI) / 180, l1 = (lng * Math.PI) / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: clamp((p2 * 180) / Math.PI, -85, 85), lng: ((((l2 * 180) / Math.PI) + 540) % 360) - 180 };
}

// Бот на всю игру: имя + догадки на все раунды + когда он «ответит» в каждом (для статуса «соперник ответил»)
export function makeBotGame(rounds, rating, timeLimit = 120) {
  const bot = BOTS[Math.floor(Math.random() * BOTS.length)];
  const mean = expectedRoundScore(rating, bot.skill);
  const guesses = rounds.map((r) => {
    const target = sampleScore(mean, bot.spread);
    const p = destination(r.lat, r.lng, kmForScore(target), Math.random() * 360);
    const km = haversineKm(p.lat, p.lng, r.lat, r.lng);
    const lim = (timeLimit || 120) * 1000;
    return { lat: +p.lat.toFixed(5), lng: +p.lng.toFixed(5), km: +km.toFixed(2), score: scoreForDistance(km), timeout: false, delay: Math.round(lim * (0.2 + Math.random() * 0.5)) };
  });
  return { name: bot.name, guesses };
}
