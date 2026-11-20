const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../bathymetry-core');
const collection = value => ({ type: 'FeatureCollection', features: [{ properties: { Depth: value } }] });

test('WMS requests preserve longitude/latitude order and select the central pixel', () => {
  const url = new URL(B.featureUrl({ lat: 38.632, lon: 26.518 }));
  assert.equal(url.searchParams.get('version'), '1.1.1');
  assert.equal(url.searchParams.get('srs'), 'EPSG:4326');
  const bbox = url.searchParams.get('bbox').split(',').map(Number);
  assert.ok(Math.abs((bbox[0] + bbox[2]) / 2 - 26.518) < 1e-9);
  assert.ok(Math.abs((bbox[1] + bbox[3]) / 2 - 38.632) < 1e-9);
  assert.equal(Number(url.searchParams.get('x')) + .5, Number(url.searchParams.get('width')) / 2);
  assert.equal(Number(url.searchParams.get('y')) + .5, Number(url.searchParams.get('height')) / 2);
});
test('null, strings, negative land elevations, no-data sentinels and invalid payloads never become sea depths', () => {
  for (const value of [null, undefined, '', '35.2', -5, -9999, Infinity, NaN, 12000, 1e20]) assert.equal(B.parseDepth(collection(value)), null);
  assert.equal(B.parseDepth(collection(0)), 0);
  assert.equal(B.parseDepth(collection(38.85043)), 38.85043);
  assert.equal(B.parseDepth({ type: 'FeatureCollection', features: [] }), null);
  assert.throws(() => B.parseDepth({ error: 'service unavailable' }));
});
test('depth classes and rendered raster share the same upper bounds and colors', () => {
  assert.equal(B.band(4.99).name, 'Çok sığ');
  assert.equal(B.band(5).min, 5);
  assert.equal(B.band(20).min, 20);
  assert.equal(B.band(50).min, 50);
  assert.equal(B.band(200).min, 200);
  assert.equal(B.band(null), null);
  assert.equal(B.band(-1), null);
  for (const band of B.BANDS) assert.ok(B.sld().includes(`color="${band.color}" quantity="${band.max}"`));
});
test('declared resolution is a geographic cell size, not a made-up depth error bound', () => {
  const size = B.gridSize(38.632);
  assert.ok(size.northSouth > 115 && size.northSouth < 117);
  assert.ok(size.eastWest > 89 && size.eastWest < 92);
  assert.equal(B.gridSize(null), null);
  assert.equal(B.gridSize(91), null);
});
test('uncovered and malformed coordinates are rejected without fabricated fallback', () => {
  for (const point of [{ lat: 0, lon: 0 }, { lat: 38, lon: 90 }, { lat: 91, lon: 26 }, { lat: '38', lon: 26 }]) assert.equal(B.featureUrl(point), null);
  assert.ok(B.covered({ lat: 38.632, lon: 26.518 }));
  assert.throws(() => B.featureUrl({ lat: 38, lon: 26 }, 'untrusted-layer'));
});
test('absent source metadata stays unknown, and metadata is returned as text without declaring a measured depth', () => {
  assert.equal(B.parseSource({ type: 'FeatureCollection', features: [] }), null);
  const data = B.parseSource({ type: 'FeatureCollection', features: [{ properties: { source: '<img onerror=alert(1)>', ignored: {}, missing: null } }] });
  assert.deepEqual(data, [{ key: 'source', value: '<img onerror=alert(1)>' }]);
});
