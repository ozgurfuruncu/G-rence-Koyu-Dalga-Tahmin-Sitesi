/* Buildless browser app: index.html can also be opened directly. */
(() => {
  'use strict';
  const C = window.SeaForecast;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const fmt = (value, digits = 0) => C.valid(value) ? value.toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
  const PLACES = {
    gulkent: { id: 'gulkent', name: 'Gülkent açıkları, Karaburun', lat: 38.632, lon: 26.518 },
    cesme: { id: 'cesme', name: 'Çeşme açıkları', lat: 38.32, lon: 26.28 },
    alacati: { id: 'alacati', name: 'Alaçatı açıkları', lat: 38.22, lon: 26.38 },
    foca: { id: 'foca', name: 'Foça açıkları', lat: 38.68, lon: 26.69 },
    kusadasi: { id: 'kusadasi', name: 'Kuşadası açıkları', lat: 37.86, lon: 27.19 },
    bodrum: { id: 'bodrum', name: 'Bodrum açıkları', lat: 37.005, lon: 27.4 }
  };
  const PROFILES = { boat: { wave: 45, wind: 12, gust: 18 }, sail: { wave: 90, wind: 18, gust: 25 }, paddle: { wave: 20, wind: 6, gust: 10 } };
  const STORAGE = 'dalga-v2';
  let storageAvailable = true;
  function read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { storageAvailable = false; return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch { storageAvailable = false; }
  }
  const pointValid = p => p && typeof p.name === 'string' && p.name.length <= 60 && C.valid(p.lat) && C.valid(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && (p.accuracy === undefined || (C.valid(p.accuracy) && p.accuracy >= 0));
  const stored = read(`${STORAGE}-settings`, {});
  const activity = Object.hasOwn(PROFILES, stored?.activity) ? stored.activity : 'boat';
  const limitsValid = l => l && C.valid(l.wave) && l.wave >= 5 && l.wave <= 1000 && C.valid(l.wind) && l.wind >= 1 && l.wind <= 100 && C.valid(l.gust) && l.gust >= l.wind && l.gust <= 150;
  const state = {
    place: pointValid(stored?.place) ? stored.place : { ...PLACES.gulkent },
    activity, limits: limitsValid(stored?.limits) ? stored.limits : { ...PROFILES[activity] },
    unit: stored?.unit === 'm' ? 'm' : 'cm',
    favorites: [], data: null, date: C.trTime().slice(0, 10), selectedTime: null,
    chart: 'wave', source: null, fetchedAt: null, best: null, request: null, toastTimer: null
  };
  const savedFavorites = read(`${STORAGE}-favorites`, []);
  state.favorites = Array.isArray(savedFavorites) ? savedFavorites.filter(pointValid).slice(0, 12) : [];
  const wave = value => `${fmt(state.unit === 'm' && C.valid(value) ? value / 100 : value, state.unit === 'm' ? 2 : 0)} ${state.unit}`;
  const placeKey = place => `${place.lat.toFixed(4)},${place.lon.toFixed(4)}`;
  const cacheKey = () => `${STORAGE}-forecast-${placeKey(state.place)}`;
  const dateLabel = (date, options = {}) => new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', ...options }).format(new Date(`${date}T12:00:00+03:00`));
  function toast(message) {
    clearTimeout(state.toastTimer);
    $('toast').textContent = message;
    $('toast').hidden = false;
    state.toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
  }
  function persist() {
    save(`${STORAGE}-settings`, { place: state.place, activity: state.activity, limits: state.limits, unit: state.unit });
  }
  function showNotice(message = '') { $('notice').textContent = message; $('notice').hidden = !message; }
  function showError(message, title = 'Tahmine ulaşılamadı') {
    $('errorTitle').textContent = title;
    $('errorMessage').textContent = message;
    $('errorBox').hidden = false;
  }
  function loading(busy) {
    $('refreshButton').disabled = busy;
    $('refreshButton').querySelector('svg').classList.toggle('busy-icon', busy);
    $('refreshButton').querySelector('span').textContent = busy ? 'Yükleniyor' : 'Yenile';
    $('forecastContent').classList.toggle('is-loading', busy);
    $('forecastContent').setAttribute('aria-busy', String(busy));
    if (busy) $('dataStatus').textContent = `${state.place.name} için model tahminleri alınıyor…`;
  }
  function syncPlace() {
    const matchesPreset = PLACES[state.place.id] && placeKey(PLACES[state.place.id]) === placeKey(state.place);
    $('placeSelect').value = matchesPreset ? state.place.id : 'custom';
    $('placeSelect').querySelector('[value="custom"]').textContent = matchesPreset ? 'Koordinat ile seç…' : state.place.name;
    $('activitySelect').value = state.activity;
    renderFavorites();
    window.dispatchEvent(new CustomEvent('dalga:place', { detail: { ...state.place } }));
  }
  function renderFavorites() {
    $('favorites').innerHTML = state.favorites.map((p, i) => `<span class="favorite-chip"><button data-favorite="${i}">${icon('pin')}${esc(p.name)}</button><button data-remove="${i}" aria-label="${esc(p.name)} noktasını favorilerden kaldır">×</button></span>`).join('');
    const selected = state.favorites.some(p => placeKey(p) === placeKey(state.place));
    $('favoriteButton').setAttribute('aria-pressed', String(selected));
    $('favoriteButton').setAttribute('aria-label', selected ? 'Bu noktayı favorilerden kaldır' : 'Bu noktayı favorilere ekle');
  }
  function dateRows(date = state.date) { return state.data?.rows.filter(r => r.date === date) || []; }
  function selectedRow() {
    const rows = dateRows();
    return rows.find(r => r.time === state.selectedTime) || rows[0];
  }
  function ensureDate() {
    const today = C.trTime().slice(0, 10);
    const dates = [...new Set((state.data?.rows || []).map(r => r.date))].filter(d => d >= today).slice(0, 7);
    if (!dates.includes(state.date)) state.date = dates[0] || today;
    const rows = dateRows();
    if (!rows.some(r => r.time === state.selectedTime)) {
      const hour = state.date === today ? Number(C.trTime().slice(11, 13)) : 12;
      state.selectedTime = rows.find(r => r.hour === hour)?.time || rows[0]?.time || null;
    }
  }
  async function requestJSON(url, signal) {
    const response = await fetch(url, { signal });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(response.status === 429 ? 'Servisin istek sınırına ulaşıldı. Biraz sonra tekrar dene.' : error?.reason || `Veri servisi yanıt vermedi (HTTP ${response.status}).`);
    }
    const data = await response.json();
    if (data.error) throw new Error(data.reason || 'Veri servisi hata döndürdü.');
    return data;
  }
  async function fetchForecast() {
    state.request?.abort();
    const controller = new AbortController();
    state.request = controller;
    const timeout = setTimeout(() => controller.abort('timeout'), 20000);
    state.data = null;
    state.best = null;
    state.source = null;
    $('downloadButton').disabled = true;
    $('showBestButton').disabled = true;
    $('errorBox').hidden = true;
    showNotice();
    renderEmpty();
    loading(true);
    $('demoButton').textContent = 'Örnek görünüm';
    const params = { latitude: state.place.lat, longitude: state.place.lon, forecast_days: 7, past_days: 1, timezone: 'Europe/Istanbul' };
    const marineUrl = `https://marine-api.open-meteo.com/v1/marine?${new URLSearchParams({ ...params, hourly: 'wave_height,wave_direction,wave_period,swell_wave_height,sea_surface_temperature', cell_selection: 'sea' })}`;
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?${new URLSearchParams({ ...params, hourly: 'temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation_probability,visibility,weather_code', daily: 'sunrise,sunset,uv_index_max', wind_speed_unit: 'kn', cell_selection: 'nearest' })}`;
    try {
      const results = await Promise.allSettled([requestJSON(marineUrl, controller.signal), requestJSON(weatherUrl, controller.signal)]);
      if (state.request !== controller) return;
      if (results[0].status === 'rejected') throw results[0].reason;
      const weather = results[1].status === 'fulfilled' ? results[1].value : null;
      const data = C.normalize(results[0].value, weather);
      const today = C.trTime().slice(0, 10);
      if (!data.rows.some(r => r.date >= today && C.valid(r.wave))) throw new Error('Bu noktada kullanılabilir deniz tahmini yok. Deniz üzerindeki başka bir koordinatı dene.');
      state.data = data;
      state.fetchedAt = new Date().toISOString();
      state.source = 'network';
      save(cacheKey(), { data, fetchedAt: state.fetchedAt });
      ensureDate();
      render();
    } catch (error) {
      if (state.request !== controller) return;
      const cached = read(cacheKey(), null);
      const cacheAge = cached ? Date.now() - new Date(cached.fetchedAt).getTime() : Infinity;
      const today = C.trTime().slice(0, 10);
      const cacheUsable = cacheAge >= 0 && cacheAge < 48 * 3600000 && Array.isArray(cached?.data?.rows) && cached.data.rows.some(r => r.date >= today && C.valid(r.wave));
      if (cacheUsable) {
        state.data = cached.data;
        state.fetchedAt = cached.fetchedAt;
        state.source = 'cache';
        ensureDate();
        render();
        showError('Bağlantı kurulamadı. Bu noktanın daha önce kaydedilen tahmini gösteriliyor; yeni model güncellemelerini içermez. Yenilemeyi tekrar dene.', 'Kaydedilmiş tahmin gösteriliyor');
      } else {
        $('dataStatus').textContent = `${state.place.name} · Veri alınamadı`;
        renderEmpty();
        showError(controller.signal.aborted ? 'Veri servisi zamanında yanıt vermedi. Bağlantını kontrol edip tekrar dene. Tasarımı incelemek için “Örnek görünüm”ü açabilirsin.' : `${error.message === 'Failed to fetch' ? 'Deniz servisine bağlanılamadı. İnternet bağlantını kontrol et.' : error.message} Yeniden deneyebilir veya örnek görünümü açabilirsin.`);
      }
    } finally {
      clearTimeout(timeout);
      if (state.request === controller) { state.request = null; loading(false); }
    }
  }
  function renderEmpty() {
    renderAccuracy();
    $('seaHeading').textContent = 'Denizden haber bekleniyor';
    $('heroDescription').textContent = state.place.name;
    $('heroTime').textContent = 'Saatlik model tahmini';
    $('mainWave').textContent = '—'; $('mainWaveUnit').textContent = state.unit;
    $('conditionBadge').textContent = 'Veri bekleniyor'; $('conditionBadge').dataset.level = 'unknown';
    $('heroRange').textContent = 'Gün içi aralık: —'; $('heroTrend').textContent = 'Düne göre: —';
    $('bestTime').innerHTML = '— <span>/ 3 saat</span>';
    $('bestWave').textContent = '—'; $('bestWind').textContent = '—';
    $('windowSubtitle').textContent = 'Seçili günün gündüz saatleri karşılaştırılır.';
    $('windowNote').textContent = 'Dalga, rüzgâr ve hamle birlikte değerlendirilir.';
    ['windValue', 'periodValue', 'directionValue', 'temperatureValue', 'sunrise', 'sunset', 'dayLength', 'rainChance', 'uvIndex', 'visibility'].forEach(id => { $(id).textContent = '—'; });
    $('windDetail').textContent = 'Yön ve hamle bekleniyor'; $('periodDetail').textContent = 'Dalgalar arası süre';
    $('directionDetail').textContent = 'Dalganın geldiği yön'; $('temperatureDetail').textContent = 'Hava / deniz sıcaklığı';
    $('dayTabs').innerHTML = '';
    $('chartWrap').innerHTML = '<div class="empty-chart">Saatlik tahmin grafiği burada görünecek.</div>';
    $('chartReadout').textContent = 'Grafikteki bir saate dokunarak ayrıntıları inceleyebilirsin.';
    $('hourlyBody').innerHTML = '<tr><td colspan="6" class="empty-cell">Henüz kullanılabilir tahmin yok.</td></tr>';
    $('insightText').textContent = 'Sadece dalganın yüksekliğine bakma. Kısa periyot, aynı yükseklikteki dalgayı daha sık hissetmene neden olur.';
  }
  function renderStatus() {
    const updated = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(state.fetchedAt));
    if (state.source === 'demo') {
      $('dataStatus').innerHTML = '<span class="demo-mark">ÖRNEK VERİ</span> · Tasarım önizlemesi';
      showNotice('ÖRNEK GÖRÜNÜM — Dalga ve hava değerleri kurgusaldır; gerçek tahmin için “Yenile”ye bas. Derinlik haritası ayrı bir gerçek coğrafi veri kaynağına bağlıdır.');
    } else {
      $('dataStatus').innerHTML = `${state.source === 'network' ? '<span class="live-dot"></span>' : ''}${state.source === 'cache' ? 'KAYDEDİLMİŞ VERİ · ' : ''}Model tahmini · Alınma: ${esc(updated)} · ${esc(fmt(Math.abs(state.place.lat), 3))}° ${state.place.lat >= 0 ? 'K' : 'G'} / ${esc(fmt(Math.abs(state.place.lon), 3))}° ${state.place.lon >= 0 ? 'D' : 'B'}`;
      const notes = [];
      if (!state.data.hasWeather) notes.push('Hava verisi alınamadı. Rüzgâr değerlendirmesi ve daha sakin saat önerisi kullanılamıyor.');
      if (state.source === 'cache') notes.push('Kaydedilen tahmin güncel olmayabilir. Daha sakin saat önerisi için verileri yenile.');
      const grid = state.data.seaGrid;
      if (grid && C.distanceNm(state.place, grid) > 8) notes.push('Deniz modelinin seçtiği hücre bu noktadan uzakta. Daha yakın bir açık deniz koordinatı seçebilirsin.');
      showNotice(notes.join(' '));
    }
    $('demoButton').textContent = state.source === 'demo' ? 'Gerçek tahmine dön' : 'Örnek görünüm';
    $('downloadButton').disabled = false;
  }
  function renderTabs() {
    const today = C.trTime().slice(0, 10);
    const dates = [...new Set(state.data.rows.map(r => r.date))].filter(d => d >= today).slice(0, 7);
    $('dayTabs').innerHTML = dates.map((date, i) => {
      const rows = dateRows(date);
      const avg = C.summary(rows).wave;
      const level = C.dayExposure(rows, state.limits);
      const name = i === 0 && date === today ? 'Bugün' : date === C.addDays(today, 1) ? 'Yarın' : dateLabel(date, { weekday: 'short' });
      return `<button class="day-tab" role="tab" aria-selected="${date === state.date}" tabindex="${date === state.date ? 0 : -1}" data-date="${date}" aria-label="${esc(dateLabel(date, { day: 'numeric', month: 'long' }))}, ortalama dalga ${esc(wave(avg))}, eşik düzeyi ${level.label}"><span>${esc(name)}</span><span class="day-date">${esc(dateLabel(date, { day: 'numeric', month: 'short' }))}</span><strong>${esc(wave(avg))}</strong><span class="day-status" data-level="${level.level}">${level.label}</span></button>`;
    }).join('');
  }
  function renderHero() {
    const row = selectedRow();
    if (!row) return;
    const sum = C.summary(dateRows());
    const prev = C.summary(dateRows(C.addDays(state.date, -1)));
    const condition = C.exposure(row, state.limits);
    const headings = { low: 'Denizde sakin bir ritim.', mid: 'Deniz biraz hareketleniyor.', high: 'Denizin temposu yükseliyor.', unknown: 'Denizi okumak için daha fazla veri.' };
    $('seaHeading').textContent = headings[condition.level];
    $('heroDescription').textContent = condition.level === 'unknown' ? 'Bazı veriler eksik; aktivite karşılaştırması yapılamıyor.' : `${$('activitySelect').selectedOptions[0].textContent} · Kişisel eşiklere göre ${condition.label.toLocaleLowerCase('tr-TR')} düzey.`;
    $('conditionBadge').textContent = condition.level === 'unknown' ? 'Eksik veri' : `${condition.label} düzey`;
    $('conditionBadge').dataset.level = condition.level;
    $('mainWave').textContent = fmt(state.unit === 'm' && C.valid(row.wave) ? row.wave / 100 : row.wave, state.unit === 'm' ? 2 : 0);
    $('mainWaveUnit').textContent = state.unit;
    $('heroTime').textContent = `${dateLabel(state.date, { day: 'numeric', month: 'short' })} · ${row.time.slice(11, 16)} TRT`;
    $('heroRange').textContent = `Gün içi aralık: ${wave(sum.min)} – ${wave(sum.max)}`;
    const diff = C.valid(sum.wave) && C.valid(prev.wave) ? sum.wave - prev.wave : null;
    $('heroTrend').textContent = diff === null ? 'Düne göre: veri yok' : Math.abs(diff) < 5 ? 'Günlük ortalama düne yakın' : `Düne göre ort. ${wave(Math.abs(diff))} ${diff > 0 ? 'daha yüksek' : 'daha düşük'}`;
    $('windValue').innerHTML = `${fmt(row.wind, 1)} <small>kn</small>`;
    $('windDetail').textContent = `${C.cardinal(row.windDir)} · Hamle ${fmt(row.gust, 1)} kn`;
    $('periodValue').innerHTML = `${fmt(row.period, 1)} <small>sn</small>`;
    $('periodDetail').textContent = `Soluğan yüksekliği ${wave(row.swell)}`;
    $('directionValue').innerHTML = `${C.valid(row.direction) ? `<span class="direction-arrow" title="Geldiği yön ${fmt(row.direction)} derece"><svg style="transform:rotate(${row.direction}deg)" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 5 13-5-3-5 3 5-13Z"/></svg></span>` : ''}${C.cardinal(row.direction)}`;
    $('directionDetail').textContent = `Geldiği yön · ${fmt(row.direction)}°`;
    $('temperatureValue').innerHTML = `${fmt(row.temp)}<small>°</small> <small>/</small> ${fmt(row.seaTemp)}<small>°C</small>`;
    $('temperatureDetail').textContent = 'Hava / deniz yüzeyi';
    const notes = [];
    if ([95, 96, 99].includes(row.code)) notes.push('Model bu saatte gök gürültülü hava gösteriyor. Resmî uyarıları ayrıca kontrol et.');
    if (C.valid(row.visibility) && row.visibility < 1000) notes.push('Bu saatte model görüşü 1 km altında.');
    if (C.valid(row.gust) && C.valid(row.wind) && row.gust - row.wind >= 7) notes.push(`Rüzgâr ${fmt(row.wind)} kn, hamleler ${fmt(row.gust)} kn. Ani hız artışlarını ortalamadan ayrı değerlendir.`);
    if (C.valid(row.period) && row.period < 4) notes.push(`${fmt(row.period, 1)} saniyelik kısa periyot, dalgaları daha sık hissedebileceğin anlamına gelir.`);
    if (state.date > C.addDays(C.trTime().slice(0, 10), 2)) notes.push('Bu tarih birkaç gün ileride; yaklaşan günlerde tahmini tekrar kontrol et.');
    $('insightText').textContent = notes.join(' ') || 'Dalga yüksekliği tek başına bütün hikâyeyi anlatmaz. Rüzgâr hamlesi, dalga periyodu ve dönüş saatindeki koşulları birlikte incele.';
  }
  function renderBest() {
    const rows = dateRows();
    const day = state.data.days[state.date];
    state.best = state.source === 'cache' ? null : C.bestWindow(rows, day, state.limits);
    $('showBestButton').disabled = !state.best;
    if (!state.best) {
      $('bestTime').innerHTML = '— <span>/ 3 saat</span>';
      $('bestWave').textContent = '—'; $('bestWind').textContent = '—';
      $('windowSubtitle').textContent = state.source === 'cache' ? 'Güncel tahmin gerekli.' : 'Karşılaştırılabilir 3 saat bulunamadı.';
      $('windowNote').textContent = state.source === 'cache' ? 'Saat önerisi için veriyi yenile.' : 'Gün ışığı, gelecek saatler ve eksiksiz hava verisi birlikte aranır. Gece veya eksik veride öneri yapılmaz.';
      return;
    }
    const best = state.best;
    $('bestTime').innerHTML = `${best.start.slice(11, 16)}–${best.end.slice(11, 16)} <span>/ 3 saat</span>`;
    $('bestWave').textContent = wave(best.wave);
    $('bestWind').textContent = `${fmt(best.wind, 1)} kn`;
    $('windowSubtitle').textContent = `${dateLabel(state.date, { day: 'numeric', month: 'long' })} · Gündüz karşılaştırması`;
    $('windowNote').textContent = best.score <= 1 ? 'Ortalamalar gösterilir. Üç saatin tamamı kişisel dalga, rüzgâr ve hamle eşiklerinin altında.' : 'Günün daha sakin aralığı olsa da kişisel eşiklerinden en az biri aşılıyor. Bu bir çıkış önerisi değildir.';
  }
  function renderDaily() {
    const day = state.data.days[state.date] || {};
    const sum = C.summary(dateRows());
    $('sunrise').textContent = day.sunrise?.slice(11, 16) || '—';
    $('sunset').textContent = day.sunset?.slice(11, 16) || '—';
    const minutes = day.sunrise && day.sunset ? Math.round((C.parseTime(day.sunset) - C.parseTime(day.sunrise)) / 60000) : null;
    $('dayLength').textContent = minutes !== null ? `${Math.floor(minutes / 60)} sa ${minutes % 60} dk` : '—';
    $('rainChance').textContent = C.valid(sum.rain) ? `%${fmt(sum.rain)}` : '—';
    $('uvIndex').textContent = C.valid(day.uv) ? `${fmt(day.uv, 1)} · ${day.uv < 3 ? 'Düşük' : day.uv < 6 ? 'Orta' : day.uv < 8 ? 'Yüksek' : 'Çok yüksek'}` : '—';
    $('visibility').textContent = C.valid(sum.visibility) ? `${fmt(sum.visibility / 1000, 1)} km` : '—';
  }
  function renderTable() {
    const now = C.trTime();
    const rows = dateRows().filter(r => $('allHours').checked || r.hour % 3 === 0);
    $('hourlyBody').innerHTML = rows.length ? rows.map(row => {
      const level = C.exposure(row, state.limits);
      return `<tr class="${row.time === state.selectedTime ? 'selected-row' : ''} ${row.time < now ? 'is-past' : ''}"><td>${row.time.slice(11, 16)}</td><td>${wave(row.wave)}</td><td>${fmt(row.period, 1)} sn</td><td>${fmt(row.wind, 1)} kn <span class="wind-cardinal">${C.cardinal(row.windDir)}</span></td><td>${fmt(row.gust, 1)} kn</td><td><span class="status-tag" data-level="${level.level}">${level.label}</span></td></tr>`;
    }).join('') : '<tr><td colspan="6" class="empty-cell">Bu gün için saatlik tahmin yok.</td></tr>';
  }
  function renderChart() {
    const rows = dateRows();
    const isWave = state.chart === 'wave';
    const conversion = isWave && state.unit === 'm' ? .01 : 1;
    const values = rows.map(r => C.valid(r[state.chart]) ? r[state.chart] * conversion : null);
    $('chartLegend').innerHTML = `<span></span>${isWave ? 'Dalga yüksekliği' : 'Rüzgâr hızı'}<i></i>Kişisel eşik`;
    document.querySelectorAll('[data-chart]').forEach(button => {
      button.classList.toggle('active', button.dataset.chart === state.chart);
      button.setAttribute('aria-pressed', String(button.dataset.chart === state.chart));
    });
    if (!values.some(C.valid)) { $('chartWrap').innerHTML = '<div class="empty-chart">Bu grafik için veri alınamadı.</div>'; return; }
    // Render at the available width so mobile axis labels retain their font size.
    const W = Math.max(280, Math.min(720, Math.round($('chartWrap').clientWidth || 720)));
    state.chartWidth = W;
    const H = 235, left = 42, right = 12, top = 20, bottom = 36;
    const limit = state.limits[state.chart] * conversion;
    const maxValue = Math.max(...values.filter(C.valid), limit) * 1.15;
    const step = maxValue <= 1 ? .25 : maxValue <= 3 ? .5 : maxValue <= 8 ? 2 : maxValue <= 25 ? 5 : maxValue <= 60 ? 15 : maxValue <= 150 ? 30 : Math.ceil(maxValue / 5 / 50) * 50;
    const ceiling = Math.ceil(maxValue / step) * step;
    const x = i => left + (W - left - right) * rows[i].hour / 23;
    const y = v => H - bottom - (H - top - bottom) * v / ceiling;
    let grid = '';
    for (let v = 0; v <= ceiling + .0001; v += step) grid += `<path class="chart-grid" d="M${left} ${y(v)}H${W - right}"/><text x="${left - 9}" y="${y(v) + 4}" text-anchor="end">${fmt(v, ceiling <= 3 ? 1 : 0)}</text>`;
    const base = H - bottom;
    const segments = [];
    let segment = [];
    values.forEach((v, i) => { if (v === null) { if (segment.length) segments.push(segment); segment = []; } else segment.push({ x: x(i), y: y(v), i }); });
    if (segment.length) segments.push(segment);
    const paths = segments.map(points => {
      const path = points.map((p, j) => `${j ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
      return `<path d="${path}L${points.at(-1).x} ${base}L${points[0].x} ${base}Z" fill="url(#chartFill)"/><path d="${path}" stroke="#258d7d" stroke-width="2.5" stroke-linejoin="round"/>`;
    }).join('');
    const best = state.best;
    const highlightStart = best ? rows.findIndex(r => r.time === best.start) : -1;
    const highlight = highlightStart >= 0 ? `<rect x="${x(highlightStart)}" y="${top}" width="${Math.min(W - right, x(highlightStart) + (W - left - right) * 3 / 23) - x(highlightStart)}" height="${base - top}" fill="#bddfc9" opacity=".22"/>` : '';
    const points = values.map((v, i) => v === null ? '' : `<circle class="chart-point ${rows[i].time === state.selectedTime ? 'selected' : ''}" data-index="${i}" cx="${x(i)}" cy="${y(v)}" r="${rows[i].time === state.selectedTime ? 5.5 : 3}" aria-hidden="true"><title>${rows[i].time.slice(11)} · ${fmt(v, conversion === .01 ? 2 : 1)} ${isWave ? state.unit : 'kn'}</title></circle>`).join('');
    const tickHours = W < 440 ? [0, 6, 12, 18, 23] : [0, 3, 6, 9, 12, 15, 18, 21, 23];
    const ticks = tickHours.map(hour => `<text x="${left + (W - left - right) * hour / 23}" y="${H - 12}" text-anchor="middle">${String(hour).padStart(2, '0')}</text>`).join('');
    $('chartWrap').innerHTML = `<svg class="forecast-chart" style="aspect-ratio:${W}/${H}" viewBox="0 0 ${W} ${H}" role="group" tabindex="0" aria-label="${isWave ? 'Dalga' : 'Rüzgâr'} grafiği. Saati değiştirmek için sağ ve sol yön tuşlarını kullan."><title>Saatlik ${isWave ? 'dalga' : 'rüzgâr'} tahmini</title><defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#48b59c" stop-opacity=".22"/><stop offset="1" stop-color="#48b59c" stop-opacity=".015"/></linearGradient></defs>${grid}${highlight}<text x="${left}" y="12">${isWave ? state.unit : 'kn'}</text><path class="chart-threshold" d="M${left} ${y(limit)}H${W - right}"/>${paths}${points}${ticks}</svg>`;
    const svg = $('chartWrap').querySelector('svg');
    svg.addEventListener('click', event => {
      const bounds = svg.getBoundingClientRect();
      const viewX = (event.clientX - bounds.left) / bounds.width * W;
      const hour = Math.max(0, Math.min(23, Math.round((viewX - left) / (W - left - right) * 23)));
      const row = rows.find(r => r.hour === hour);
      if (row) selectTime(row.time);
    });
    svg.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const current = rows.findIndex(r => r.time === state.selectedTime);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, current + (event.key === 'ArrowRight' ? 1 : -1)));
      selectTime(rows[next].time);
      $('chartWrap').querySelector('svg')?.focus({ preventScroll: true });
    });
  }
  function renderReadout() {
    const row = selectedRow();
    $('chartReadout').textContent = row ? `${row.time.slice(11, 16)} · Dalga ${wave(row.wave)} · Periyot ${fmt(row.period, 1)} sn · Rüzgâr ${fmt(row.wind, 1)} kn · Hamle ${fmt(row.gust, 1)} kn${row.time < C.trTime() ? ' · Geçmiş saat' : ''}` : 'Saatlik veri yok.';
  }
  function selectTime(time) {
    state.selectedTime = time;
    renderHero(); renderChart(); renderReadout(); renderTable();
  }
  function render() {
    if (!state.data) return;
    ensureDate(); renderStatus(); renderTabs(); renderHero(); renderBest(); renderDaily(); renderChart(); renderReadout(); renderTable(); renderAccuracy();
  }
  function renderAccuracy() {
    const source = state.source;
    $('accuracySource').textContent = source === 'demo' ? 'Örnek tahmin' : source === 'cache' ? 'Kaydedilmiş tahmin' : state.data ? 'Model tahmini' : 'Veri bekleniyor';
    const grid = source === 'demo' ? null : state.data?.seaGrid;
    const distance = grid ? C.distanceNm(state.place, grid) : null;
    $('modelDistance').textContent = C.valid(distance) ? `${fmt(distance * 1.852, 1)} km` : 'Bilinmiyor';
    $('modelLocation').textContent = grid && C.valid(grid.lat) && C.valid(grid.lon) ? `Dalga hücresi: ${fmt(grid.lat, 4)}°, ${fmt(grid.lon, 4)}°. Bu uzaklık, modelin çözünürlüğü veya hata payı değildir.` : 'Dalga model hücresinin konumu doğrulanamadı.';
    const rows = dateRows();
    const complete = rows.filter(row => [row.wave, row.period, row.direction, row.wind, row.gust, row.visibility, row.code].every(C.valid)).length;
    $('coverageValue').textContent = state.data ? `${complete} / 24` : '—';
    const notes = [];
    if (source === 'demo') notes.push('Bu paneldeki dalga ve hava verileri örnektir. Haritadaki derinlik verisi bağımsızdır; ona örnek değer eklenmez.');
    else {
      if (C.valid(distance) && distance * 1.852 > 5) notes.push('Dalga hücresi seçili noktadan 5 km üzerinde uzakta; kıyı ve koy içi koşulları ayrıca değişebilir.');
      if (state.data && complete < 24) notes.push('Seçili günün bazı saatlerinde veri eksik; boşluklar sakin deniz kabul edilmez.');
      if (source === 'cache') notes.push('Bu tahmin kaydedilmiş veriden geliyor; son model güncellemelerini içermeyebilir.');
      if (state.date > C.addDays(C.trTime().slice(0, 10), 2)) notes.push('İleri tarihli tahminlerde belirsizlik artar. Tarih yaklaştığında yeniden kontrol et.');
      if (C.valid(state.place.accuracy)) notes.push(`Cihazın bildirdiği konum belirsizliği yaklaşık ${fmt(state.place.accuracy)} m. Haritadaki çember bu yarıçapı gösterir.`);
    }
    $('accuracyNote').textContent = notes.join(' ') || 'Veri eksiksiz olsa da sıfır hata anlamına gelmez. Kıyı biçimi, sığlıklar ve yerel rüzgârlar model hücresi içinde değişebilir.';
    window.DalgaDepth?.setForecast({ grid, source });
  }
  function setPlace(place) {
    state.place = { ...place };
    state.selectedTime = null;
    syncPlace(); persist(); calculateRoute(); fetchForecast();
  }
  function openSettings() {
    $('lat').value = state.place.lat; $('lon').value = state.place.lon;
    $('customName').value = state.place.name;
    $('waveLimit').value = state.limits.wave; $('windLimit').value = state.limits.wind; $('gustLimit').value = state.limits.gust;
    $('waveUnit').value = state.unit; $('settingsError').textContent = '';
    $('settingsDialog').showModal();
  }
  function calculateRoute(event) {
    event?.preventDefault();
    const dest = $('routeDestination').value;
    const to = dest === 'custom' ? { lat: $('destLat').valueAsNumber, lon: $('destLon').valueAsNumber } : PLACES[dest];
    const result = C.route(state.place, to, $('boatSpeed').valueAsNumber, $('fuelRate').valueAsNumber);
    if (!result) { $('routeResults').innerHTML = '<p class="form-error">Geçerli koordinat, sıfırdan büyük hız ve geçerli tüketim gir.</p>'; return; }
    const totalMinutes = Math.round(result.hours * 60);
    $('routeResults').innerHTML = `<div><span>Mesafe</span><strong>${fmt(result.distance, 1)} <small>deniz mili</small></strong></div><div><span>Tek yön süre</span><strong>${Math.floor(totalMinutes / 60)} <small>sa</small> ${totalMinutes % 60} <small>dk</small></strong></div><div><span>Yakıt · tek yön + %30</span><strong>${fmt(result.fuel, 1)} <small>litre</small></strong></div>`;
  }
  function updateChecklist() {
    const inputs = [...document.querySelectorAll('[data-check]')];
    $('checkCount').textContent = `${inputs.filter(input => input.checked).length} / ${inputs.length}`;
    save(`${STORAGE}-checklist`, { date: C.trTime().slice(0, 10), checked: inputs.filter(input => input.checked).map(input => input.dataset.check) });
  }
  function exportCSV() {
    if (!state.data) return;
    const cell = value => {
      const content = typeof value === 'string' && /^\s*[=+@-]/.test(value) ? `'${value}` : String(value ?? '');
      return `"${content.replace(/"/g, '""')}"`;
    };
    const lines = [
      ['Nokta', state.place.name], ['Koordinat', state.place.lat, state.place.lon],
      ['Veri türü', state.source === 'demo' ? 'ÖRNEK VERİ - gerçek tahmin değildir' : state.source === 'cache' ? 'Kaydedilmiş model tahmini' : 'Open-Meteo model tahmini'],
      ['Alınma zamanı (UTC)', state.fetchedAt], ['Saat dilimi', 'Europe/Istanbul (UTC+3)'],
      ['Saat', 'Dalga (cm)', 'Periyot (sn)', 'Dalga yönü (derece)', 'Soluğan (cm)', 'Rüzgâr (knot)', 'Rüzgâr yönü (derece)', 'Hamle (knot)', 'Hava (C)', 'Deniz (C)', 'Yağış olasılığı (%)', 'Görüş (m)', 'Kişisel eşik düzeyi'],
      ...dateRows().map(r => [r.time, r.wave, r.period, r.direction, r.swell, r.wind, r.windDir, r.gust, r.temp, r.seaTemp, r.rain, r.visibility, C.exposure(r, state.limits).label])
    ];
    const blob = new Blob(['\ufeff' + lines.map(row => row.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `dalga-${state.source === 'demo' ? 'ornek-' : ''}${state.date}.csv`; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('Saatlik tahmin CSV olarak indirildi.');
  }

  $('refreshButton').addEventListener('click', fetchForecast);
  $('retryButton').addEventListener('click', fetchForecast);
  $('placeSelect').addEventListener('change', event => {
    if (event.target.value === 'custom') { openSettings(); syncPlace(); }
    else setPlace(PLACES[event.target.value]);
  });
  $('activitySelect').addEventListener('change', event => {
    state.activity = event.target.value; state.limits = { ...PROFILES[state.activity] }; persist();
    render(); toast(`Profil eşikleri: ${state.limits.wave} cm dalga · ${state.limits.wind} kn rüzgâr · ${state.limits.gust} kn hamle.`);
  });
  $('settingsButton').addEventListener('click', openSettings);
  $('closeSettings').addEventListener('click', () => $('settingsDialog').close());
  $('settingsForm').addEventListener('submit', event => {
    event.preventDefault();
    const place = { id: 'custom', name: $('customName').value.trim(), lat: $('lat').valueAsNumber, lon: $('lon').valueAsNumber };
    const limits = { wave: $('waveLimit').valueAsNumber, wind: $('windLimit').valueAsNumber, gust: $('gustLimit').valueAsNumber };
    if (!place.name || !pointValid(place) || !limitsValid(limits)) { $('settingsError').textContent = 'Geçerli konum ve eşikler gir. Hamle eşiği rüzgâr eşiğinden düşük olamaz.'; return; }
    const changed = placeKey(place) !== placeKey(state.place);
    if (!changed && C.valid(state.place.accuracy)) place.accuracy = state.place.accuracy;
    if (!changed && place.name === state.place.name) place.id = state.place.id;
    state.place = place; state.limits = limits; state.unit = $('waveUnit').value;
    syncPlace(); persist(); $('settingsDialog').close(); calculateRoute();
    if (changed) fetchForecast(); else render();
    toast('Konum ve kişisel eşikler güncellendi.');
  });
  $('favoriteButton').addEventListener('click', () => {
    const index = state.favorites.findIndex(p => placeKey(p) === placeKey(state.place));
    if (index >= 0) state.favorites.splice(index, 1);
    else if (state.favorites.length < 12) state.favorites.push({ ...state.place });
    else { toast('En fazla 12 favori ekleyebilirsin.'); return; }
    save(`${STORAGE}-favorites`, state.favorites); renderFavorites();
    toast(storageAvailable ? index >= 0 ? 'Nokta favorilerden kaldırıldı.' : 'Nokta favorilerine eklendi.' : 'Tarayıcı kayıt alanı kullanılamıyor. Favoriler yalnızca bu oturumda tutulacak.');
  });
  $('favorites').addEventListener('click', event => {
    const remove = event.target.closest('[data-remove]');
    if (remove) { state.favorites.splice(Number(remove.dataset.remove), 1); save(`${STORAGE}-favorites`, state.favorites); renderFavorites(); return; }
    const button = event.target.closest('[data-favorite]');
    if (button) setPlace(state.favorites[Number(button.dataset.favorite)]);
  });
  $('geolocateButton').addEventListener('click', () => {
    if (!navigator.geolocation) { toast('Bu tarayıcı konum bilgisini desteklemiyor. Koordinatları ayarlardan girebilirsin.'); return; }
    $('geolocateButton').disabled = true;
    navigator.geolocation.getCurrentPosition(position => {
      $('geolocateButton').disabled = false;
      setPlace({ id: 'custom', name: 'Bulunduğum konum', lat: position.coords.latitude, lon: position.coords.longitude, accuracy: position.coords.accuracy });
      toast('Konumun seçildi. Deniz üzerindeki en yakın model hücresi sorgulanıyor.');
    }, error => {
      $('geolocateButton').disabled = false;
      toast(error.code === 1 ? 'Konum izni verilmedi. Koordinatları ayarlardan girebilirsin.' : 'Konum alınamadı. Koordinatları ayarlardan girebilirsin.');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
  $('dayTabs').addEventListener('click', event => {
    const tab = event.target.closest('[data-date]');
    if (!tab) return;
    state.date = tab.dataset.date; state.selectedTime = null; render();
    $('dayTabs').querySelector('[aria-selected="true"]')?.focus({ preventScroll: true });
  });
  $('dayTabs').addEventListener('keydown', event => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...$('dayTabs').querySelectorAll('[data-date]')];
    const index = tabs.findIndex(tab => tab.dataset.date === state.date);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
    tabs[next]?.click();
  });
  document.querySelectorAll('[data-chart]').forEach(button => button.addEventListener('click', () => { state.chart = button.dataset.chart; if (state.data) renderChart(); }));
  $('allHours').addEventListener('change', renderTable);
  $('showBestButton').addEventListener('click', () => {
    if (!state.best) return;
    selectTime(state.best.start);
    $('forecastHeading').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  });
  $('demoButton').addEventListener('click', () => {
    if (state.source === 'demo') { fetchForecast(); return; }
    state.request?.abort(); state.request = null; loading(false);
    state.data = C.demoData(C.trTime().slice(0, 10)); state.source = 'demo'; state.fetchedAt = new Date().toISOString(); state.selectedTime = null;
    state.date = C.addDays(C.trTime().slice(0, 10), 1);
    $('errorBox').hidden = true; render();
  });
  $('downloadButton').addEventListener('click', exportCSV);
  window.addEventListener('dalga:pick-place', event => {
    if (pointValid(event.detail)) setPlace(event.detail);
  });
  $('routeForm').addEventListener('submit', calculateRoute);
  $('routeDestination').addEventListener('change', () => {
    const custom = $('routeDestination').value === 'custom';
    $('destLatLabel').hidden = !custom; $('destLonLabel').hidden = !custom;
    $('destLat').required = custom; $('destLon').required = custom;
    // Disabled hidden fields must not block form validation.
    $('destLat').disabled = !custom; $('destLon').disabled = !custom;
    calculateRoute();
  });
  const savedChecks = read(`${STORAGE}-checklist`, {});
  document.querySelectorAll('[data-check]').forEach(input => {
    input.checked = savedChecks?.date === C.trTime().slice(0, 10) && Array.isArray(savedChecks.checked) && savedChecks.checked.includes(input.dataset.check);
    input.addEventListener('change', updateChecklist);
  });
  $('resetChecklist').addEventListener('click', () => { document.querySelectorAll('[data-check]').forEach(input => { input.checked = false; }); updateChecklist(); });
  function updateDate() {
    $('todayDate').textContent = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', weekday: 'long' }).format(new Date());
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      updateDate();
      const checks = read(`${STORAGE}-checklist`, {});
      if (checks?.date !== C.trTime().slice(0, 10)) {
        document.querySelectorAll('[data-check]').forEach(input => { input.checked = false; });
        updateChecklist();
      }
      if (state.data) render();
    }
  });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => {
    const width = Math.max(280, Math.min(720, Math.round($('chartWrap').clientWidth)));
    if (state.data && width !== state.chartWidth) renderChart();
  }).observe($('chartWrap'));
  updateDate(); syncPlace(); updateChecklist(); calculateRoute();
  $('destLat').disabled = true; $('destLon').disabled = true;
  fetchForecast();
})();
