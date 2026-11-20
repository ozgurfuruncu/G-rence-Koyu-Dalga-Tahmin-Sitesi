/* Shared forecast calculations. No DOM, network, or invented wave corrections. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SeaForecast = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const HOUR = 3600000;
  const valid = value => typeof value === 'number' && Number.isFinite(value);
  const number = value => valid(value) ? value : null;
  const mean = values => {
    const clean = values.filter(valid);
    return clean.length ? clean.reduce((sum, n) => sum + n, 0) / clean.length : null;
  };
  const extreme = (values, fn) => {
    const clean = values.filter(valid);
    return clean.length ? fn(...clean) : null;
  };
  function trTime(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(date);
    const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  }
  const parseTime = time => new Date(`${time}:00+03:00`).getTime();
  function addDays(date, amount) {
    const d = new Date(`${date}T12:00:00+03:00`);
    d.setUTCDate(d.getUTCDate() + amount);
    return trTime(d).slice(0, 10);
  }
  function cardinal(deg) {
    if (!valid(deg)) return '—';
    return ['K', 'KKD', 'KD', 'DKD', 'D', 'DGD', 'GD', 'GGD', 'G', 'GGB', 'GB', 'BGB', 'B', 'BKB', 'KB', 'KKB'][Math.round(((deg % 360 + 360) % 360) / 22.5) % 16];
  }
  function circularMean(values) {
    const clean = values.filter(valid);
    if (!clean.length) return null;
    const x = mean(clean.map(v => Math.cos(v * Math.PI / 180)));
    const y = mean(clean.map(v => Math.sin(v * Math.PI / 180)));
    return Math.hypot(x, y) < 0.01 ? null : (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  function normalize(marine, weather) {
    if (!marine?.hourly?.time?.length || !Array.isArray(marine.hourly.wave_height)) throw new Error('Deniz servisi geçerli saatlik veri döndürmedi.');
    if (marine.hourly_units?.wave_height && marine.hourly_units.wave_height !== 'm') throw new Error('Deniz servisinin dalga birimi beklenen metre birimi değil.');
    if (weather?.hourly_units?.wind_speed_10m && weather.hourly_units.wind_speed_10m !== 'kn') throw new Error('Hava servisinin rüzgâr birimi beklenen knot birimi değil.');
    const nonnegative = value => valid(value) && value >= 0 ? value : null;
    const direction = value => valid(value) && value >= 0 && value <= 360 ? value : null;
    const weatherCodes = new Set([0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]);
    const mh = marine.hourly;
    const wh = weather?.hourly || {};
    // Match timestamps, never assume the two independent models share array indices.
    const weatherIndex = new Map((wh.time || []).map((t, i) => [t, i]));
    const rows = mh.time.map((time, i) => {
      const j = weatherIndex.get(time);
      const w = key => j === undefined ? null : number(wh[key]?.[j]);
      const wave = number(mh.wave_height[i]);
      return {
        time, date: time.slice(0, 10), hour: Number(time.slice(11, 13)),
        wave: wave !== null && wave >= 0 ? wave * 100 : null,
        period: nonnegative(mh.wave_period?.[i]), direction: direction(mh.wave_direction?.[i]),
        swell: nonnegative(mh.swell_wave_height?.[i]) !== null ? mh.swell_wave_height[i] * 100 : null,
        seaTemp: number(mh.sea_surface_temperature?.[i]), wind: nonnegative(w('wind_speed_10m')),
        gust: nonnegative(w('wind_gusts_10m')), windDir: direction(w('wind_direction_10m')), temp: w('temperature_2m'),
        rain: w('precipitation_probability') !== null && w('precipitation_probability') >= 0 && w('precipitation_probability') <= 100 ? w('precipitation_probability') : null,
        visibility: nonnegative(w('visibility')), code: weatherCodes.has(w('weather_code')) ? w('weather_code') : null
      };
    });
    const days = {};
    const daily = weather?.daily || {};
    (daily.time || []).forEach((day, i) => {
      days[day] = { sunrise: daily.sunrise?.[i] || null, sunset: daily.sunset?.[i] || null, uv: number(daily.uv_index_max?.[i]) };
    });
    return { rows, days, hasWeather: rows.some(r => valid(r.wind)), seaGrid: { lat: marine.latitude, lon: marine.longitude }, weatherGrid: weather ? { lat: weather.latitude, lon: weather.longitude } : null };
  }
  function summary(rows) {
    return {
      wave: mean(rows.map(r => r.wave)), min: extreme(rows.map(r => r.wave), Math.min),
      max: extreme(rows.map(r => r.wave), Math.max), wind: mean(rows.map(r => r.wind)),
      gust: extreme(rows.map(r => r.gust), Math.max), period: mean(rows.map(r => r.period)),
      direction: circularMean(rows.map(r => r.direction)), windDir: circularMean(rows.map(r => r.windDir)),
      temp: mean(rows.map(r => r.temp)), seaTemp: mean(rows.map(r => r.seaTemp)),
      rain: extreme(rows.map(r => r.rain), Math.max), visibility: extreme(rows.map(r => r.visibility), Math.min)
    };
  }
  function exposure(row, limits) {
    if (!row || !limits || ![limits.wave, limits.wind, limits.gust].every(v => valid(v) && v > 0)) return { level: 'unknown', label: 'Eksik veri', score: null };
    const storm = [95, 96, 99].includes(row.code);
    const fog = valid(row.visibility) && row.visibility < 1000;
    const ratios = ['wave', 'wind', 'gust'].filter(key => valid(row[key])).map(key => row[key] / limits[key]);
    const knownMaximum = ratios.length ? Math.max(...ratios) : null;
    if (knownMaximum > 1.5 || storm || fog) return { level: 'high', label: 'Yüksek', score: knownMaximum };
    if (![row.wave, row.wind, row.gust, row.visibility, row.code].every(valid)) return { level: 'unknown', label: 'Eksik veri', score: null };
    const score = knownMaximum;
    if (score > 1) return { level: 'mid', label: 'Artmış', score };
    return { level: 'low', label: 'Düşük', score };
  }
  function dayExposure(rows, limits) {
    const levels = rows.map(r => exposure(r, limits));
    const high = levels.find(r => r.level === 'high');
    if (high) return high;
    if (rows.length !== 24 || levels.some(r => r.level === 'unknown')) return { level: 'unknown', label: 'Eksik veri', score: null };
    return levels.find(r => r.level === 'mid') || levels[0];
  }
  function bestWindow(rows, day, limits, now = new Date()) {
    if (!day?.sunrise || !day?.sunset) return null;
    const nowMs = now.getTime();
    const sunriseMs = parseTime(day.sunrise);
    const sunsetMs = parseTime(day.sunset);
    let best = null;
    for (let i = 0; i <= rows.length - 3; i++) {
      const group = rows.slice(i, i + 3);
      const start = parseTime(group[0].time);
      const end = parseTime(group[2].time) + HOUR;
      if (start < nowMs || start < sunriseMs || end > sunsetMs) continue;
      if (group.some((r, j) => parseTime(r.time) !== start + j * HOUR)) continue;
      if (group.some(r => ![r.wave, r.wind, r.gust, r.visibility, r.code].every(valid) || r.visibility < 1000 || [95, 96, 99].includes(r.code))) continue;
      const score = Math.max(...group.map(r => exposure(r, limits).score));
      const average = mean(group.map(r => exposure(r, limits).score));
      if (!best || score < best.score || (score === best.score && average < best.average)) {
        best = { start: group[0].time, end: trTime(new Date(end)), rows: group, score, average, ...summary(group) };
      }
    }
    return best;
  }
  function distanceNm(from, to) {
    if (![from.lat, from.lon, to.lat, to.lon].every(valid) || Math.abs(from.lat) > 90 || Math.abs(to.lat) > 90 || Math.abs(from.lon) > 180 || Math.abs(to.lon) > 180) return null;
    const rad = n => n * Math.PI / 180;
    const a = Math.sin(rad(to.lat - from.lat) / 2) ** 2 + Math.cos(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.sin(rad(to.lon - from.lon) / 2) ** 2;
    return 3440.065 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
  }
  function route(from, to, speed, fuel) {
    const distance = distanceNm(from, to);
    if (distance === null || !valid(speed) || speed <= 0 || !valid(fuel) || fuel < 0) return null;
    const hours = distance / speed;
    return { distance, hours, fuel: hours * fuel * 1.3 };
  }
  function demoData(today) {
    const rows = [];
    const days = {};
    for (let d = -1; d < 7; d++) {
      const date = addDays(today, d);
      days[date] = { sunrise: `${date}T07:15`, sunset: `${date}T18:05`, uv: 3.2 + Math.max(0, d) * .3 };
      for (let hour = 0; hour < 24; hour++) {
        const cycle = Math.sin((hour - 9) / 24 * Math.PI * 2);
        const wave = Math.max(8, 34 + cycle * 17 + Math.sin(d * 1.8) * 17 + (d === -1 ? 20 : 0));
        const wind = Math.max(2, 8 + cycle * 4 + Math.sin(d * 1.8) * 3);
        rows.push({ time: `${date}T${String(hour).padStart(2, '0')}:00`, date, hour, wave, period: 3.8 + Math.sin(hour / 7) * .8,
          direction: 330, swell: wave * .3, seaTemp: 20.4, wind, gust: wind + 4.5, windDir: 345,
          temp: 18 + Math.sin((hour - 7) / 24 * Math.PI * 2) * 4, rain: d === 3 ? 55 : 5, visibility: 24000, code: 2 });
      }
    }
    return { rows, days, hasWeather: true, seaGrid: null };
  }
  return { valid, number, mean, extreme, trTime, parseTime, addDays, cardinal, circularMean, normalize, summary, exposure, dayExposure, bestWindow, distanceNm, route, demoData };
});
