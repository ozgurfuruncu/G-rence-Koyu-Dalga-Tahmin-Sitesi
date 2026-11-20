/* Dependency-free Chrome DevTools smoke test.
   Run a static server on :5173 and an isolated headless Chrome on :9222, then:
   node tests/browser-smoke.cjs
   Screenshots are written to the OS temporary directory. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const C = require('../forecast-core');

async function main() {
  const target = await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' }).then(r => r.json());
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  const handlers = new Map();
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const call = pending.get(message.id);
      if (!call) return;
      pending.delete(message.id);
      message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result);
    } else handlers.get(message.method)?.(message.params);
  };
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ' ' + (result.exceptionDetails.exception?.description || ''));
    return result.result.value;
  }
  async function waitFor(expression, timeout = 10000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out: ${expression}; map status: ${await evaluate(`document.getElementById('depthMapStatus')?.textContent`)}`);
  }
  async function screenshot(name) {
    const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const filename = path.join(os.tmpdir(), `dalga-${name}.png`);
    fs.writeFileSync(filename, Buffer.from(result.data, 'base64'));
    console.log('Screenshot:', filename);
  }
  async function click(id) { await evaluate(`document.getElementById(${JSON.stringify(id)}).click()`); }
  async function setValue(id, value, event = 'change') {
    await evaluate(`(() => { const e = document.getElementById(${JSON.stringify(id)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })); })()`);
  }
  const errors = [];
  handlers.set('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text));
  await send('Page.enable'); await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
  let mode = process.argv.includes('--live') ? 'live' : 'fixture';
  let depthMode = process.argv.includes('--live') ? 'live' : 'normal';
  const blankPNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==';
  const fixture = C.demoData(C.trTime().slice(0, 10));
  const marine = { latitude: 38.625, longitude: 26.5, hourly: { time: fixture.rows.map(r => r.time) } };
  const weather = { hourly: { time: fixture.rows.map(r => r.time) }, daily: { time: Object.keys(fixture.days) } };
  const mFields = { wave_height: 'wave', wave_period: 'period', wave_direction: 'direction', swell_wave_height: 'swell', sea_surface_temperature: 'seaTemp' };
  for (const [key, field] of Object.entries(mFields)) marine.hourly[key] = fixture.rows.map(r => r[field] / (['wave', 'swell'].includes(field) ? 100 : 1));
  const wFields = { temperature_2m: 'temp', wind_speed_10m: 'wind', wind_direction_10m: 'windDir', wind_gusts_10m: 'gust', precipitation_probability: 'rain', visibility: 'visibility', weather_code: 'code' };
  for (const [key, field] of Object.entries(wFields)) weather.hourly[key] = fixture.rows.map(r => r[field]);
  for (const [key, field] of Object.entries({ sunrise: 'sunrise', sunset: 'sunset', uv_index_max: 'uv' })) weather.daily[key] = Object.values(fixture.days).map(d => d[field]);
  handlers.set('Fetch.requestPaused', async event => {
    try {
      const url = new URL(event.request.url);
      if (url.hostname === 'ows.emodnet-bathymetry.eu' || url.hostname === 'tile.openstreetmap.org') {
        if (depthMode === 'live') { await send('Fetch.continueRequest', { requestId: event.requestId }); return; }
        const isQuery = url.searchParams.get('request')?.toLowerCase() === 'getfeatureinfo';
        let responseCode = 200, body, contentType;
        if (isQuery) {
          const isSource = url.searchParams.get('query_layers') === 'emodnet:source_references';
          let features = [];
          if (!isSource && depthMode !== 'missing') {
            const lat = Number(url.searchParams.get('bbox').split(',')[1]) + .0005;
            features = [{ properties: { Depth: lat < 38.62 ? 120 : 38.85 } }];
          }
          responseCode = depthMode === 'error' ? 503 : 200;
          body = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features })).toString('base64');
          contentType = 'application/json';
          if (depthMode === 'slow' && !isSource) await new Promise(resolve => setTimeout(resolve, 500));
        } else {
          if (depthMode === 'tiles-error' && url.hostname === 'ows.emodnet-bathymetry.eu') { await send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'InternetDisconnected' }); return; }
          body = blankPNG; contentType = 'image/png';
        }
        await send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode, responseHeaders: [{ name: 'Content-Type', value: contentType }, { name: 'Access-Control-Allow-Origin', value: '*' }], body });
        return;
      }
      const isMarine = event.request.url.includes('marine-api');
      if (mode === 'live') { await send('Fetch.continueRequest', { requestId: event.requestId }); return; }
      if (mode === 'offline' || (mode === 'marine-only' && !isMarine)) {
        await send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'InternetDisconnected' });
      } else {
        await send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from(JSON.stringify(isMarine ? marine : weather)).toString('base64') });
      }
    } catch (error) { if (!/Invalid InterceptionId/i.test(error.message)) errors.push(error.message); }
  });
  await send('Fetch.enable', { patterns: [{ urlPattern: 'https://*.open-meteo.com/*' }, { urlPattern: 'https://ows.emodnet-bathymetry.eu/*' }, { urlPattern: 'https://tile.openstreetmap.org/*' }] });
  try {
    const init = await send('Page.addScriptToEvaluateOnNewDocument', { source: 'try { localStorage.clear(); } catch {}' });
    const pageUrl = process.argv.includes('--file') ? pathToFileURL(path.resolve(__dirname, '../index.html')).href : 'http://127.0.0.1:5173';
    await send('Page.navigate', { url: pageUrl });
    await waitFor(`document.getElementById('forecastContent')?.getAttribute('aria-busy') === 'false'`, 25000);
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: init.identifier });
    assert.equal(await evaluate(`document.querySelectorAll('[data-date]').length`), 7);
    assert.notEqual(await evaluate(`document.getElementById('mainWave').textContent`), '—');
    assert.equal(await evaluate(`document.getElementById('errorBox').hidden`), true);
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
    console.log('PASS: forecast loads, 7 day tabs render, desktop has no overflow');
    if (mode === 'live') {
      console.log('LIVE:', await evaluate(`document.getElementById('dataStatus').textContent`));
      await screenshot('live-desktop');
      await evaluate(`document.getElementById('derinlik').scrollIntoView(); window.DalgaDepth.activate()`);
      await waitFor(`document.getElementById('depthValue').textContent !== '—'`, 25000);
      await waitFor(`document.getElementById('depthMapStatus').textContent.includes('katmanı yüklendi')`, 30000);
      console.log('LIVE DEPTH:', await evaluate(`document.getElementById('depthValue').textContent + ' m · ' + document.getElementById('depthSourceDetail').textContent`));
      await screenshot('live-depth-desktop');
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await evaluate(`document.getElementById('derinlik').scrollIntoView()`);
      await screenshot('live-depth-mobile');
      assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
      await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
      depthMode = 'normal';
      await evaluate(`scrollTo(0,0)`);
    }
    await click('demoButton');
    assert.match(await evaluate(`document.getElementById('notice').textContent`), /kurgusaldır/);
    assert.equal(await evaluate(`document.querySelectorAll('#hourlyBody tr').length`), 8);
    await click('allHours');
    assert.equal(await evaluate(`document.querySelectorAll('#hourlyBody tr').length`), 24);
    await click('showBestButton');
    assert.match(await evaluate(`document.getElementById('heroTime').textContent`), /08:00/);
    await evaluate(`document.querySelector('[aria-selected="true"]').focus()`);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    assert.equal(await evaluate(`document.querySelector('[aria-selected="true"]').dataset.date`), C.addDays(C.trTime().slice(0, 10), 2));
    await evaluate(`document.querySelectorAll('[data-date]')[1].click()`);
    await evaluate(`window.__originalObjectURL = URL.createObjectURL; URL.createObjectURL = blob => { window.__csvBlob = blob; return window.__originalObjectURL(blob); }; window.__originalAnchorClick = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function() {};`);
    await click('downloadButton');
    const csv = await evaluate(`window.__csvBlob.text()`);
    assert.match(csv, /ÖRNEK VERİ/);
    assert.match(csv, /Europe\/Istanbul/);
    assert.match(csv, /Dalga \(cm\)/);
    assert.equal(csv.trim().split('\r\n').length, 30);
    await evaluate(`URL.createObjectURL = window.__originalObjectURL; HTMLAnchorElement.prototype.click = window.__originalAnchorClick; scrollTo(0,0)`);
    await screenshot('desktop');
    await evaluate(`document.querySelector('[data-chart="wind"]').click()`);
    assert.match(await evaluate(`document.getElementById('chartLegend').textContent`), /Rüzgâr/);
    await evaluate(`document.querySelector('#chartWrap svg').focus()`);
    const originalHour = await evaluate(`document.getElementById('heroTime').textContent`);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    assert.notEqual(await evaluate(`document.getElementById('heroTime').textContent`), originalHour);
    const waveValue = await evaluate(`document.getElementById('mainWave').textContent`);
    await click('settingsButton');
    assert.equal(await evaluate(`document.getElementById('settingsDialog').open`), true);
    await setValue('waveUnit', 'm');
    await evaluate(`document.getElementById('settingsForm').requestSubmit()`);
    assert.equal(await evaluate(`document.getElementById('settingsDialog').open`), false);
    assert.equal(await evaluate(`document.getElementById('mainWaveUnit').textContent`), 'm');
    assert.ok(Math.abs(Number((await evaluate(`document.getElementById('mainWave').textContent`)).replace(',', '.')) * 100 - Number(waveValue)) <= 1);
    await setValue('activitySelect', 'paddle');
    assert.match(await evaluate(`document.getElementById('heroDescription').textContent`), /Kano/);
    await click('favoriteButton');
    assert.equal(await evaluate(`document.getElementById('favoriteButton').getAttribute('aria-pressed')`), 'true');
    await evaluate(`document.querySelector('[data-check="vest"]').click()`);
    assert.match(await evaluate(`document.getElementById('checkCount').textContent`), /1 \/ 6/);
    await setValue('boatSpeed', '0');
    await evaluate(`document.getElementById('routeForm').dispatchEvent(new Event('submit', { cancelable: true }))`);
    assert.match(await evaluate(`document.getElementById('routeResults').textContent`), /Geçerli/);
    await setValue('boatSpeed', '12');
    await evaluate(`document.getElementById('routeForm').requestSubmit()`);
    assert.match(await evaluate(`document.getElementById('routeResults').textContent`), /deniz mili/);
    console.log('PASS: explicit sample labeling, 24 hours, day/hour keyboard controls, best window, CSV contents, chart switch, units, profile, favorites, checklist, route validation');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate(`document.getElementById('toast').hidden = true`);
    await evaluate(`scrollTo(0,0)`);
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
    await screenshot('mobile');
    await evaluate(`document.getElementById('forecastHeading').scrollIntoView()`);
    await screenshot('mobile-chart');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.getElementById('forecastHeading').scrollIntoView()`);
    await screenshot('desktop-chart');
    await evaluate(`document.getElementById('planla').scrollIntoView()`);
    await screenshot('desktop-planning');
    await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 780, deviceScaleFactor: 1, mobile: true });
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
    console.log('PASS: 390px and 320px mobile have no page overflow');
    mode = 'offline';
    await send('Page.reload');
    await waitFor(`document.getElementById('forecastContent')?.getAttribute('aria-busy') === 'false'`);
    assert.match(await evaluate(`document.getElementById('dataStatus').textContent`), /KAYDEDİLMİŞ/);
    assert.equal(await evaluate(`document.getElementById('showBestButton').disabled`), true);
    assert.equal(await evaluate(`document.getElementById('errorBox').hidden`), false);
    assert.equal(await evaluate(`document.getElementById('favoriteButton').getAttribute('aria-pressed')`), 'true');
    assert.match(await evaluate(`document.getElementById('checkCount').textContent`), /1 \/ 6/);
    console.log('PASS: offline cache is labeled, suggestions disabled, settings/favorites/checklist persist');
    mode = 'marine-only'; await click('refreshButton');
    await waitFor(`document.getElementById('forecastContent').getAttribute('aria-busy') === 'false'`);
    assert.notEqual(await evaluate(`document.getElementById('mainWave').textContent`), '—');
    assert.match(await evaluate(`document.getElementById('conditionBadge').textContent`), /Eksik|Yüksek/);
    assert.equal(await evaluate(`document.getElementById('showBestButton').disabled`), true);
    console.log('PASS: partial weather failure preserves waves and prevents false low classification');
    await evaluate(`document.getElementById('derinlik').scrollIntoView(); window.DalgaDepth.activate()`);
    await evaluate(`window.DalgaDepth.inspect({ lat: 38.632, lon: 26.518 })`);
    await waitFor(`document.getElementById('depthMapStatus').textContent.includes('katmanı yüklendi')`);
    assert.match(await evaluate(`document.getElementById('depthValue').textContent`), /39/);
    assert.match(await evaluate(`document.getElementById('depthSourceDetail').textContent`), /doğrulanamadı/);
    assert.equal(await evaluate(`document.querySelectorAll('#depthLegend > div').length`), 6);
    depthMode = 'slow';
    await evaluate(`void window.DalgaDepth.inspect({ lat: 38.632, lon: 26.518 })`);
    assert.equal(await evaluate(`document.getElementById('depthValue').textContent`), '—');
    await new Promise(resolve => setTimeout(resolve, 100));
    depthMode = 'normal';
    await evaluate(`window.DalgaDepth.inspect({ lat: 38.6, lon: 26.42 })`);
    await new Promise(resolve => setTimeout(resolve, 550));
    assert.match(await evaluate(`document.getElementById('depthValue').textContent`), /120/);
    assert.match(await evaluate(`document.getElementById('depthPointCoordinates').textContent`), /38,60000/);
    depthMode = 'tiles-error';
    await send('Page.reload', { ignoreCache: true });
    await waitFor(`document.getElementById('forecastContent')?.getAttribute('aria-busy') === 'false'`);
    await evaluate(`document.getElementById('derinlik').scrollIntoView(); window.DalgaDepth.activate()`);
    await waitFor(`document.getElementById('depthMapStatus').textContent.includes('parçaları yüklenemedi')`);
    depthMode = 'normal';
    await click('depthRetry');
    await waitFor(`document.getElementById('depthMapStatus').textContent.includes('katmanı yüklendi')`);
    await click('depthContours');
    assert.equal(await evaluate(`document.getElementById('depthContours').checked`), true);
    depthMode = 'missing';
    await evaluate(`window.DalgaDepth.inspect({ lat: 38.63, lon: 26.52 })`);
    assert.equal(await evaluate(`document.getElementById('depthValue').textContent`), '—');
    assert.equal(await evaluate(`document.getElementById('depthUsePoint').disabled`), true);
    depthMode = 'error';
    await evaluate(`window.DalgaDepth.inspect({ lat: 38.63, lon: 26.52 })`);
    assert.equal(await evaluate(`document.getElementById('depthValue').textContent`), '—');
    assert.match(await evaluate(`document.getElementById('depthPointStatus').textContent`), /değer üretilmedi/);
    assert.equal(await evaluate(`document.getElementById('depthRetry').hidden`), false);
    depthMode = 'normal';
    await evaluate(`window.DalgaDepth.inspect({ lat: 0, lon: 0 })`);
    assert.match(await evaluate(`document.getElementById('depthBand').textContent`), /Kapsam dışında/);
    await evaluate(`window.DalgaDepth.inspect({ lat: 38.6, lon: 26.42 })`);
    assert.match(await evaluate(`document.getElementById('depthValue').textContent`), /120/);
    await click('depthUsePoint');
    await waitFor(`document.getElementById('forecastContent').getAttribute('aria-busy') === 'false'`);
    assert.equal(await evaluate(`document.getElementById('placeSelect').value`), 'custom');
    assert.match(await evaluate(`document.getElementById('depthLocationName').textContent`), /Haritadan seçilen/);
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
    console.log('PASS: depth legend, contours, unknown metadata, missing depth, query/tile errors, stale request cancellation, coverage boundaries and forecast handoff');
    mode = 'offline';
    await click('settingsButton');
    await setValue('customName', '<img src=x onerror=alert(1)>');
    await setValue('lat', '38.5'); await setValue('lon', '26.5');
    await evaluate(`document.getElementById('settingsForm').requestSubmit()`);
    await waitFor(`document.getElementById('forecastContent').getAttribute('aria-busy') === 'false'`);
    assert.equal(await evaluate(`document.getElementById('mainWave').textContent`), '—');
    assert.equal(await evaluate(`document.querySelectorAll('img[src="x"]').length`), 0);
    assert.equal(await evaluate(`document.getElementById('downloadButton').disabled`), true);
    console.log('PASS: a different point never shows old point data; custom names render as text');
    assert.deepEqual(errors, []);
    console.log('PASS: no JavaScript runtime errors');
    await evaluate(`localStorage.clear()`);
  } finally {
    await send('Target.closeTarget', { targetId: target.id }).catch(() => {});
    ws.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
