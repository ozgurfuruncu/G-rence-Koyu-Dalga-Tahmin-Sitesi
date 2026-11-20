(() => {
  'use strict';
  const B = window.Bathymetry;
  const $ = id => document.getElementById(id);
  const fmt = (n, digits = 0) => n.toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  let origin = null, inspected = null, model = null, map = null;
  let originMarker = null, inspectionMarker = null, modelMarker = null, accuracyCircle = null;
  let baseLayer = null, depthLayer = null, contours = null, query = null;
  let tiles = { loading: false, loaded: 0, failed: 0, baseFailed: false, contourFailed: false };
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  $('depthLegend').innerHTML = B.BANDS.map(b => `<div><i style="background:${b.color}"></i><span>${b.label}</span></div>`).join('');
  function coordinates(point) {
    return `${fmt(Math.abs(point.lat), 5)}° ${point.lat >= 0 ? 'K' : 'G'} · ${fmt(Math.abs(point.lon), 5)}° ${point.lon >= 0 ? 'D' : 'B'}`;
  }
  function mapStatus() {
    const status = $('depthMapStatus');
    const errors = [];
    if (tiles.failed) errors.push('Bazı derinlik parçaları yüklenemedi; eksik alanları yorumlama.');
    if (tiles.baseFailed) errors.push('Coğrafi altlık kısmen yüklenemedi.');
    if (tiles.contourFailed) errors.push('İzobat çizgileri yüklenemedi.');
    if (errors.length) status.textContent = errors.join(' ');
    else if (tiles.loading) status.textContent = 'Gerçek derinlik katmanı yükleniyor…';
    else status.textContent = tiles.loaded ? 'EMODnet derinlik katmanı yüklendi · Sayısal değer için bir noktaya dokun.' : 'Derinlik katmanı bekleniyor…';
    status.dataset.state = errors.length ? 'error' : 'normal';
    $('depthRetry').hidden = !errors.length && !$('depthPointStatus').dataset.error;
  }
  function marker(point, kind, label) {
    const tooltip = document.createElement('span'); tooltip.textContent = label;
    return L.marker([point.lat, point.lon], {
      icon: L.divIcon({ className: `depth-marker ${kind}`, iconSize: kind === 'inspection-marker' ? [16, 16] : [18, 18] }),
      title: label, alt: label, keyboard: true, zIndexOffset: kind === 'inspection-marker' ? 1000 : 0
    }).bindTooltip(tooltip).addTo(map);
  }
  function updateMarkers() {
    if (!map || !origin) return;
    if (originMarker) map.removeLayer(originMarker);
    originMarker = marker(origin, '', `Tahmin noktası: ${origin.name}`);
    if (accuracyCircle) { map.removeLayer(accuracyCircle); accuracyCircle = null; }
    if (B.valid(origin.accuracy) && origin.accuracy > 0) accuracyCircle = L.circle([origin.lat, origin.lon], {
      radius: origin.accuracy, color: '#147b70', weight: 1, fillOpacity: .06, interactive: false
    }).addTo(map);
    if (modelMarker) { map.removeLayer(modelMarker); modelMarker = null; }
    if (model && B.validPoint(model)) modelMarker = marker(model, 'wave-model-marker', 'Open-Meteo dalga model hücresi');
  }
  function clearReading(message) {
    $('depthValue').textContent = '—';
    $('depthValueUnit').textContent = 'm';
    $('depthBand').textContent = 'Derinlik bilinmiyor';
    $('depthBand').style.borderColor = '#98ada5';
    $('depthPointStatus').textContent = message;
    $('depthPointStatus').removeAttribute('data-error');
    $('depthSourceDetail').textContent = 'Henüz doğrulanmadı.';
    $('depthRetrieved').textContent = '—';
    $('depthMetadata').hidden = true;
    $('depthMetadataFields').replaceChildren();
    $('depthUsePoint').disabled = true;
  }
  async function getJSON(url, signal) {
    const response = await fetch(url, { signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`Derinlik servisi yanıt vermedi (HTTP ${response.status}).`);
    return response.json();
  }
  async function inspect(point) {
    if (!B.validPoint(point)) return;
    query?.abort();
    const controller = new AbortController(); query = controller;
    inspected = { lat: point.lat, lon: point.lon };
    $('depthPointCoordinates').textContent = coordinates(inspected);
    const size = B.gridSize(point.lat);
    $('depthResolution').textContent = `1/16′ · yaklaşık ${fmt(size.northSouth)} × ${fmt(size.eastWest)} m`;
    clearReading('Derinlik ve kaynak bilgisi sorgulanıyor…');
    if (map) {
      if (inspectionMarker) map.removeLayer(inspectionMarker);
      inspectionMarker = marker(inspected, 'inspection-marker', 'İncelenen derinlik noktası');
    }
    if (!B.covered(point)) {
      clearReading('Bu konum, bağlanan EMODnet derinlik katmanının kapsamı dışında. Başka bir bölgeyi deneyebilirsin.');
      $('depthBand').textContent = 'Kapsam dışında'; query = null; return;
    }
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const [depthResult, sourceResult] = await Promise.allSettled([
        getJSON(B.featureUrl(point), controller.signal).then(B.parseDepth),
        getJSON(B.featureUrl(point, 'emodnet:source_references'), controller.signal).then(B.parseSource)
      ]);
      if (query !== controller) return;
      if (depthResult.status === 'rejected') throw depthResult.reason;
      const depth = depthResult.value;
      $('depthRetrieved').textContent = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date());
      if (depth === null) {
        $('depthPointStatus').textContent = 'Bu noktada geçerli deniz derinliği bulunamadı. Kara, kıyı sınırı veya veri boşluğu olabilir; sıfır derinlik kabul edilmez.';
        $('depthBand').textContent = 'Geçerli veri yok';
        $('depthSourceDetail').textContent = 'Derinlik doğrulanamadı.';
        return;
      }
      const band = B.band(depth);
      // Whole metres and an approximation sign prevent false centimetre precision.
      $('depthValue').textContent = depth > 0 && depth < 1 ? '< 1' : `≈ ${fmt(depth)}`;
      $('depthBand').textContent = `${band.name} · ${band.label}`;
      $('depthBand').style.borderColor = band.color;
      $('depthPointStatus').textContent = 'Bu değer hücre ortalamasıdır. Hücrenin içindeki en sığ noktayı veya anlık su derinliğini vermez.';
      const source = sourceResult.status === 'fulfilled' ? sourceResult.value : null;
      $('depthSourceDetail').textContent = source?.length ? 'Kaynak metadatası mevcut; aşağıda inceleyebilirsin.' : sourceResult.status === 'rejected' ? 'Kaynak metadatasına ulaşılamadı; doğrudan ölçüm olduğu doğrulanamadı.' : 'Bu hücre için kaynak metadatası dönmedi; doğrudan ölçüm olduğu doğrulanamadı.';
      if (source?.length) {
        $('depthMetadataFields').innerHTML = source.map(field => `<div><dt>${escape(field.key)}</dt><dd>${escape(field.value)}</dd></div>`).join('');
        $('depthMetadata').hidden = false;
      }
      // A valid depth is required before this point can be applied as a sea forecast point.
      $('depthUsePoint').disabled = false;
    } catch (error) {
      if (query !== controller) return;
      clearReading('Derinlik servisine ulaşılamadı. Bu nokta için bir değer üretilmedi; yeniden deneyebilirsin.');
      $('depthPointStatus').dataset.error = 'true';
    } finally {
      clearTimeout(timeout);
      if (query === controller) { query = null; mapStatus(); }
    }
  }
  function activate() {
    if (map || !origin) return;
    if (!window.L) {
      $('depthMapStatus').textContent = 'Harita kütüphanesi yüklenemedi. Yerel vendor klasörünü kontrol et.';
      $('depthMapStatus').dataset.state = 'error'; return;
    }
    $('depthPlaceholder').hidden = true;
    map = L.map('depthMap', { scrollWheelZoom: false, minZoom: 5, maxZoom: 15, preferCanvas: true, zoomControl: false,
      center: [Math.max(-85, Math.min(85, origin.lat)), origin.lon], zoom: 12 });
    map.createPane('base'); map.getPane('base').style.zIndex = 200;
    map.createPane('depth'); map.getPane('depth').style.zIndex = 250;
    map.createPane('contours'); map.getPane('contours').style.zIndex = 300;
    baseLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { pane: 'base', maxZoom: 15,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>' }).addTo(map);
    baseLayer.on('tileerror', () => { tiles.baseFailed = true; mapStatus(); });
    depthLayer = L.tileLayer.wms(B.WMS, { layers: 'emodnet:mean', styles: '', sld_body: B.sld(), format: 'image/png',
      transparent: true, version: '1.1.1', pane: 'depth', tileSize: 512, maxZoom: 15, keepBuffer: 1,
      attribution: '<a href="https://emodnet.ec.europa.eu/en/bathymetry" target="_blank" rel="noopener noreferrer">EMODnet Bathymetry</a>' });
    depthLayer.on('loading', () => { tiles.loading = true; tiles.loaded = 0; tiles.failed = 0; mapStatus(); });
    depthLayer.on('tileload', () => { tiles.loaded++; });
    depthLayer.on('tileerror', () => { tiles.failed++; mapStatus(); });
    depthLayer.on('load', () => { tiles.loading = false; mapStatus(); });
    depthLayer.addTo(map);
    contours = L.tileLayer.wms(B.WMS, { layers: 'emodnet:contours', format: 'image/png', transparent: true,
      version: '1.1.1', pane: 'contours', tileSize: 512, maxZoom: 15, keepBuffer: 1 });
    contours.on('tileerror', () => { tiles.contourFailed = true; mapStatus(); });
    L.control.zoom({ position: 'topright', zoomInTitle: 'Yakınlaştır', zoomOutTitle: 'Uzaklaştır' }).addTo(map);
    L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map);
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>');
    map.on('click', event => { const point = event.latlng.wrap(); inspect({ lat: point.lat, lon: point.lng }); });
    updateMarkers(); inspect(origin);
  }
  function setPlace(point) {
    if (!B.validPoint(point)) return;
    const changed = !origin || origin.lat !== point.lat || origin.lon !== point.lon;
    origin = { ...point };
    $('depthLocationName').textContent = point.name;
    if (!map) {
      $('depthPointCoordinates').textContent = coordinates(point);
      const size = B.gridSize(point.lat);
      $('depthResolution').textContent = `1/16′ · yaklaşık ${fmt(size.northSouth)} × ${fmt(size.eastWest)} m`;
      return;
    }
    updateMarkers();
    if (changed) { map.setView([Math.max(-85, Math.min(85, point.lat)), point.lon], 12); inspect(point); }
  }
  $('depthOpen').addEventListener('click', activate);
  $('depthRecenter').addEventListener('click', () => {
    activate();
    if (map && origin) { map.setView([Math.max(-85, Math.min(85, origin.lat)), origin.lon], 12); inspect(origin); }
  });
  $('depthRetry').addEventListener('click', () => {
    tiles.baseFailed = false; tiles.contourFailed = false;
    baseLayer?.redraw();
    depthLayer?.redraw();
    if ($('depthContours').checked) contours?.redraw();
    if (inspected) inspect(inspected);
  });
  $('depthContours').addEventListener('change', event => {
    activate();
    if (!map) return;
    if (event.target.checked) contours.addTo(map); else { map.removeLayer(contours); tiles.contourFailed = false; mapStatus(); }
  });
  $('depthUsePoint').addEventListener('click', () => {
    if (!inspected || $('depthUsePoint').disabled) return;
    window.dispatchEvent(new CustomEvent('dalga:pick-place', { detail: { ...inspected, name: 'Haritadan seçilen nokta', id: 'custom' } }));
    $('tahmin').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  });
  window.addEventListener('dalga:place', event => setPlace(event.detail));
  window.DalgaDepth = { activate, inspect, setForecast(value) { model = value?.source === 'demo' ? null : value?.grid; updateMarkers(); } };
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { activate(); if (map) observer.disconnect(); }
    }, { rootMargin: '180px' });
    observer.observe($('depthMap'));
  }
})();
