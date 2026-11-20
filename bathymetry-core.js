/* Geographic and WMS calculations shared by the map and its tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Bathymetry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const WMS = 'https://ows.emodnet-bathymetry.eu/wms';
  const BANDS = [
    { min: 0, max: 5, color: '#f0bd75', label: '0–5 m', name: 'Çok sığ' },
    { min: 5, max: 20, color: '#b4ded3', label: '5–20 m', name: 'Sığ' },
    { min: 20, max: 50, color: '#6ebec3', label: '20–50 m', name: 'Kıyı derinliği' },
    { min: 50, max: 100, color: '#3897b5', label: '50–100 m', name: 'Derinleşen alan' },
    { min: 100, max: 200, color: '#276689', label: '100–200 m', name: 'Derin' },
    { min: 200, max: 12000, color: '#193a60', label: '200 m üzeri', name: 'Daha derin' }
  ];
  const valid = value => typeof value === 'number' && Number.isFinite(value);
  const validPoint = point => point && valid(point.lat) && valid(point.lon) && Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180;
  // Limit this integration to the geographic extent advertised for the EMODnet mean grid.
  const covered = point => validPoint(point) && point.lat >= 11 && point.lat <= 89.9 && point.lon >= -70.5 && point.lon <= 43;
  function band(depth) {
    if (!valid(depth) || depth < 0 || depth >= 12000) return null;
    return BANDS.find(b => depth >= b.min && depth < b.max) || null;
  }
  function gridSize(latitude) {
    if (!valid(latitude) || Math.abs(latitude) > 90) return null;
    return { northSouth: 111320 / 960, eastWest: 111320 / 960 * Math.cos(latitude * Math.PI / 180) };
  }
  function featureUrl(point, layer = 'emodnet:mean') {
    if (!covered(point)) return null;
    if (!['emodnet:mean', 'emodnet:source_references'].includes(layer)) throw new Error('Unsupported bathymetry layer');
    // WMS 1.1.1 uses longitude,latitude for EPSG:4326. An odd-sized image places
    // the requested point at the exact centre of pixel (50,50), avoiding axis swaps.
    const delta = .0005;
    const bbox = [point.lon - delta, point.lat - delta, point.lon + delta, point.lat + delta];
    return `${WMS}?${new URLSearchParams({ service: 'WMS', version: '1.1.1', request: 'GetFeatureInfo', layers: layer, query_layers: layer,
      styles: '', srs: 'EPSG:4326', bbox: bbox.map(n => n.toFixed(8)).join(','), width: 101, height: 101, x: 50, y: 50,
      feature_count: 1, info_format: 'application/json' })}`;
  }
  function parseDepth(payload) {
    if (payload?.type !== 'FeatureCollection' || !Array.isArray(payload.features)) throw new Error('Derinlik servisi beklenen veri biçimini döndürmedi.');
    const value = payload.features[0]?.properties?.Depth;
    // Do not turn null, empty strings, no-data sentinels or land elevations into a depth.
    return valid(value) && value >= 0 && value < 12000 ? value : null;
  }
  function parseSource(payload) {
    if (payload?.type !== 'FeatureCollection' || !Array.isArray(payload.features)) throw new Error('Kaynak metadatası okunamadı.');
    const p = payload.features[0]?.properties;
    if (!p || !Object.keys(p).length) return null;
    // Preserve the provider's metadata as text. Its presence is not an accuracy certificate.
    return Object.entries(p).filter(([key, value]) => value !== null && ['string', 'number', 'boolean'].includes(typeof value))
      .slice(0, 16).map(([key, value]) => ({ key: String(key).slice(0, 100), value: String(value).slice(0, 500) }));
  }
  function sld() {
    // GeoServer interval quantities are upper bounds; zero/negative values are
    // transparent. Keep this table identical to the visible legend.
    const entries = `<ColorMapEntry color="#ffffff" quantity="0" opacity="0"/>` + BANDS.map(b =>
      `<ColorMapEntry color="${b.color}" quantity="${b.max}" opacity="1" label="${b.label}"/>`).join('');
    return `<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld"><NamedLayer><Name>emodnet:mean</Name><UserStyle><FeatureTypeStyle><Rule><RasterSymbolizer><ColorMap type="intervals">${entries}</ColorMap></RasterSymbolizer></Rule></FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>`;
  }
  return { WMS, BANDS, valid, validPoint, covered, band, gridSize, featureUrl, parseDepth, parseSource, sld };
});
