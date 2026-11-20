const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../forecast-core');

const limits = { wave: 45, wind: 12, gust: 18 };
const day = { sunrise: '2026-11-21T07:30', sunset: '2026-11-21T18:10' };
const now = new Date('2026-11-20T12:00:00+03:00');
function row(hour, overrides = {}) {
  return { time: `2026-11-21T${String(hour).padStart(2, '0')}:00`, wave: 30, wind: 6, gust: 10, visibility: 20000, code: 0, ...overrides };
}

test('Türkiye date remains correct across UTC midnight and month boundaries', () => {
  assert.equal(C.trTime(new Date('2026-11-20T22:30:00Z')), '2026-11-21T01:30');
  assert.equal(C.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(C.addDays('2026-03-01', -1), '2026-02-28');
});
test('missing values stay unknown while measured zero remains zero', () => {
  const data = C.normalize({ hourly: { time: ['2026-11-21T00:00', '2026-11-21T01:00'], wave_height: [null, 0] } }, null);
  assert.equal(data.rows[0].wave, null);
  assert.equal(data.rows[1].wave, 0);
  assert.equal(C.summary(data.rows).wave, 0);
  assert.equal(C.summary([data.rows[0]]).wave, null);
  assert.equal(C.exposure(data.rows[0], limits).level, 'unknown');
  assert.equal(data.hasWeather, false);
});
test('independent model responses are joined by timestamp, not array index', () => {
  const data = C.normalize({ hourly: { time: ['2026-11-21T00:00', '2026-11-21T01:00'], wave_height: [.45, .6] } }, {
    hourly: { time: ['2026-11-21T01:00', '2026-11-21T00:00'], wind_speed_10m: [12, 5], wind_direction_10m: [90, 0] }
  });
  assert.equal(data.rows[0].wave, 45);
  assert.equal(data.rows[0].wind, 5);
  assert.equal(data.rows[1].wind, 12);
});
test('wind directions use circular statistics and correct east-southeast cardinal', () => {
  assert.ok(Math.min(C.circularMean([350, 10]), 360 - C.circularMean([350, 10])) < .001);
  assert.equal(C.circularMean([90, 270]), null);
  assert.equal(C.cardinal(112.5), 'DGD');
  assert.equal(C.cardinal(-10), 'K');
  assert.equal(C.cardinal(null), '—');
});
test('gust, thunderstorms, and poor visibility affect comparison', () => {
  assert.equal(C.exposure(row(8, { gust: 30 }), limits).level, 'high');
  assert.equal(C.exposure(row(8, { code: 95 }), limits).level, 'high');
  assert.equal(C.exposure(row(8, { visibility: 500 }), limits).level, 'high');
  assert.equal(C.exposure(row(8, { wave: 50 }), limits).level, 'mid');
  assert.equal(C.exposure(row(8, { wave: 45, wind: 12, gust: 18 }), limits).level, 'low');
});
test('day comparison does not label incomplete data as low', () => {
  assert.equal(C.dayExposure([row(8), row(9, { gust: null })], limits).level, 'unknown');
  assert.equal(C.dayExposure([], limits).level, 'unknown');
  assert.equal(C.dayExposure([row(8, { wave: 100 }), row(9, { gust: null })], limits).level, 'high');
});
test('best window uses full daylight hours and the worst hour, rather than only an average', () => {
  const rows = [row(7), row(8), row(9), row(10, { gust: 25 }), row(11), row(12), row(13)];
  const best = C.bestWindow(rows, day, limits, now);
  assert.equal(best.start, '2026-11-21T11:00');
  assert.equal(best.end, '2026-11-21T14:00');
  assert.ok(best.score < 1);
});
test('best window rejects missing weather, storm, fog, and nonconsecutive samples', () => {
  assert.equal(C.bestWindow([row(8), row(9, { wind: null }), row(10)], day, limits, now), null);
  assert.equal(C.bestWindow([row(8), row(9, { code: 95 }), row(10)], day, limits, now), null);
  assert.equal(C.bestWindow([row(8), row(9, { visibility: 500 }), row(10)], day, limits, now), null);
  assert.equal(C.bestWindow([row(8), row(9), row(11)], day, limits, now), null);
  assert.equal(C.bestWindow([row(8), row(9), row(10)], {}, limits, now), null);
});
test('recommendation never starts in the past or ends after sunset', () => {
  assert.equal(C.bestWindow([row(8), row(9), row(10)], day, limits, new Date('2026-11-21T08:01:00+03:00')), null);
  assert.equal(C.bestWindow([row(16), row(17), row(18)], day, limits, now), null);
  assert.ok(C.bestWindow([row(15), row(16), row(17)], day, limits, now));
});
test('distance and fuel calculation use nautical miles, knots, and 30 percent allowance', () => {
  const result = C.route({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }, 10, 5);
  assert.ok(Math.abs(result.distance - 60.04) < .02);
  assert.ok(Math.abs(result.hours - 6.004) < .002);
  assert.ok(Math.abs(result.fuel - 39.026) < .02);
  assert.equal(C.route({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }, 0, 5), null);
  assert.equal(C.distanceNm({ lat: 91, lon: 0 }, { lat: 0, lon: 0 }), null);
});
test('demo covers a past day plus seven forecast days and is deterministic', () => {
  const data = C.demoData('2026-11-20');
  assert.equal(data.rows.length, 8 * 24);
  assert.equal(data.rows[0].date, '2026-11-19');
  assert.equal(data.rows.at(-1).date, '2026-11-26');
  assert.deepEqual(data, C.demoData('2026-11-20'));
});
test('missing visibility or weather code cannot produce a reassuring low classification', () => {
  assert.equal(C.exposure(row(8, { visibility: null }), limits).level, 'unknown');
  assert.equal(C.exposure(row(8, { code: null }), limits).level, 'unknown');
  assert.equal(C.exposure(row(8, { wind: null, code: 95 }), limits).level, 'high');
  assert.equal(C.exposure(row(8, { wind: null, wave: 100 }), limits).level, 'high');
  assert.equal(C.dayExposure([row(8)], limits).level, 'unknown');
});
test('unexpected API units and impossible values are not silently displayed as correct values', () => {
  const marine = { hourly: { time: ['2026-11-21T08:00'], wave_height: [.4], wave_period: [-5], wave_direction: [999], swell_wave_height: [-3] } };
  assert.throws(() => C.normalize({ ...marine, hourly_units: { wave_height: 'cm' } }, null));
  assert.throws(() => C.normalize(marine, { hourly_units: { wind_speed_10m: 'km/h' } }));
  const data = C.normalize(marine, { hourly: { time: ['2026-11-21T08:00'], wind_speed_10m: [-5], wind_gusts_10m: [-8], visibility: [-5], weather_code: [123], precipitation_probability: [120] } });
  for (const key of ['wind', 'gust', 'visibility', 'code', 'rain', 'period', 'direction', 'swell']) assert.equal(data.rows[0][key], null);
});
