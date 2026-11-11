// расстояние между точками (км) и очки за раунд
export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// максимум 5000, спад по экспоненте; 1492.7 км — подобрано так, чтобы
// промах на ~1500 км давал около 1800 очков (как в привычных играх этого жанра)
export const MAX_SCORE = 5000;
export function scoreForDistance(km) {
  if (km < 0.05) return MAX_SCORE; // попал в 50 метров — максимум
  return Math.round(MAX_SCORE * Math.exp(-km / 1492.7));
}
