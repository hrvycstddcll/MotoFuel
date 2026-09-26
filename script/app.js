(function () {
  'use strict';

  var ROUTE_KEY = 'motofuel.route.v1';
  var THEME_KEY = 'motofuel.theme.v1';
  var NOMINATIM = 'https://nominatim.openstreetmap.org';
  var OSRM = 'https://router.project-osrm.org/route/v1/driving';

  var state = {
    start: null, end: null,
    efficiency: 25, price: 65,
    arming: 'start', lastGeo: 0
  };

  var map, startMarker, endMarker, meMarker, meCircle, routeLine, accuracyCircle;
  var geoCache = {};

  var $ = function (id) { return document.getElementById(id); };
  var num = function (v) { var n = parseFloat(v); return isFinite(n) ? n : NaN; };
  var fmtNum = function (n, dp) {
    if (!isFinite(n)) return '--';
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(n);
  };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /* ---------- theme ---------- */
  var ICON_SUN = '<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var ICON_MOON = '<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  function applyTheme(theme) {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    $('themeIcon').innerHTML = theme === 'dark' ? ICON_MOON : ICON_SUN;
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  }

  /* ---------- geocoding (Nominatim allows max 1 req/sec) ---------- */
  function politeFetch(url) {
    var wait = 1000 - (Date.now() - state.lastGeo);
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        state.lastGeo = Date.now();
        fetch(url, { headers: { Accept: 'application/json' } })
          .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            resolve(r.json());
          })
          .catch(reject);
      }, wait > 0 ? wait : 0);
    });
  }

  function reverseGeocode(lat, lng) {
    var key = lat.toFixed(4) + ',' + lng.toFixed(4);
    if (geoCache[key]) return Promise.resolve(geoCache[key]);
    var url = NOMINATIM + '/reverse?format=jsonv2&lat=' + lat + '&lon=' + lng + '&zoom=18&addressdetails=1';
    return politeFetch(url).then(function (data) {
      var a = data.address || {};
      var name = a.name || a.road || a.suburb || a.city || a.town || a.village || data.name || 'Dropped pin';
      var place = { name: name, full: data.display_name || '' };
      geoCache[key] = place;
      return place;
    }).catch(function () {
      return { name: 'Dropped pin', full: '' };
    });
  }

  /* ---------- place search ---------- */
  var lastResults = null;

  function closeSuggestions() {
    $('suggestions').classList.add('hidden');
    $('suggestions').innerHTML = '';
    lastResults = null;
  }

  var searchSeq = 0;
  var searchTimer = null;

  function renderSuggestions(results) {
    var list = $('suggestions');
    if (!results.length) {
      list.innerHTML = '<li class="px-3 py-3 text-xs text-zinc-500 dark:text-zinc-400">No places found</li>';
      list.classList.remove('hidden');
      return;
    }
    var which = state.arming || 'start';
    var badge = which === 'end'
      ? 'bg-red-500/15 text-red-600 dark:text-red-400'
      : 'bg-green-500/15 text-green-600 dark:text-green-400';
    var badgeText = which === 'end' ? 'Set as destination' : 'Set as start';

    list.innerHTML = results.map(function (r, i) {
      var label = r.name || r.display_name.split(',')[0];
      return '<li><button type="button" data-i="' + i + '" class="w-full px-3 py-2.5 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-800">' +
        '<span class="block text-sm font-semibold">' + esc(label) + '</span>' +
        '<span class="mt-0.5 block text-[11px] text-zinc-500 dark:text-zinc-400">' + esc(r.display_name) + '</span>' +
        '<span class="mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ' + badge + '">' + badgeText + '</span>' +
        '</button></li>';
    }).join('');
    list.classList.remove('hidden');
    list.querySelectorAll('button').forEach(function (btn) {
      btn.addEventListener('click', function () { applySearchResult(results[Number(btn.dataset.i)]); });
    });
  }

  function runSearch(q) {
    var query = q.trim();
    if (query.length < 3) { closeSuggestions(); return; }
    var seq = ++searchSeq;
    $('searchSpin').classList.remove('hidden');
    var url = NOMINATIM + '/search?format=jsonv2&limit=6&addressdetails=1&q=' + encodeURIComponent(query);

    politeFetch(url).then(function (results) {
      if (seq !== searchSeq) return;
      $('searchSpin').classList.add('hidden');
      lastResults = results;
      renderSuggestions(results);
    }).catch(function () {
      if (seq !== searchSeq) return;
      $('searchSpin').classList.add('hidden');
      closeSuggestions();
      $('mapHint').textContent = 'Place search failed. You can still tap the map to pin a point.';
    });
  }

  function applySearchResult(r) {
    if (!r) return;
    var lat = parseFloat(r.lat), lng = parseFloat(r.lon);
    if (!isFinite(lat) || !isFinite(lng)) return;
    var which = state.arming || 'start';
    var label = r.name || r.display_name.split(',')[0];
    closeSuggestions();
    $('placeSearch').value = '';
    setPoint(which, lat, lng, label);
    // Once both points exist, recompute() fits the whole route itself.
    if (!(state.start && state.end)) map.setView([lat, lng], 14);
    setArming(which === 'start' ? 'end' : 'start');
    $('mapHint').textContent = which === 'end'
      ? 'Destination set from search. Tap the map to change it.'
      : 'Start set from search. Tap the map to change it.';
  }

  /* ---------- map ---------- */
  function initMap() {
    map = L.map('map', { zoomControl: true, worldCopyJump: true }).setView([20, 0], 2);

    var satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, maxNativeZoom: 18,
      attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community'
    });
    var street = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    L.control.layers({ 'Satellite': satellite, 'Street': street }, null, { position: 'topright' }).addTo(map);

    map.on('click', function (e) { onMapClick(e.latlng.lat, e.latlng.lng); });
    updateCursor();
  }

  function makePin(cls, letter) {
    return L.divIcon({
      className: '', iconSize: [26, 26], iconAnchor: [13, 13],
      html: '<div class="pin ' + cls + '">' + letter + '</div>'
    });
  }

  function updateCursor() {
    $('map').style.cursor = state.arming ? 'crosshair' : '';
  }

  /* The "which point am I setting" choice is shared between the toolbar button
     and the search box, so both always agree. */
  function renderTarget() {
    var isStart = state.arming === 'start';
    [['targetStart', isStart], ['targetEnd', !isStart]].forEach(function (pair) {
      var btn = $(pair[0]);
      btn.classList.toggle('bg-brand-500', pair[1]);
      btn.classList.toggle('text-zinc-950', pair[1]);
      btn.classList.toggle('bg-white', !pair[1]);
      btn.classList.toggle('dark:bg-zinc-900', !pair[1]);
      btn.setAttribute('aria-pressed', pair[1] ? 'true' : 'false');
    });
    // Keep an open result list in sync with the newly chosen target.
    if (!$('suggestions').classList.contains('hidden') && lastResults) renderSuggestions(lastResults);
  }

  function setArming(which) {
    state.arming = which;
    $('setDestBtn').classList.toggle('bg-brand-500', which === 'end');
    $('setDestBtn').classList.toggle('text-zinc-950', which === 'end');
    $('setDestBtn').classList.toggle('font-bold', which === 'end');
    updateCursor();
    renderTarget();
    $('mapHint').textContent = which === 'end'
      ? 'Tap the map to set your destination.'
      : 'Tap the map to drop a start point.';
  }

  /* Keep every control that depends on which points exist in sync. */
  function syncPointControls() {
    $('clearStart').disabled = !state.start;
    $('clearEnd').disabled = !state.end;
    $('swapBtn').disabled = !(state.start && state.end);
    $('clearRouteBtn').disabled = !(state.start || state.end);
  }

  function setPoint(which, lat, lng, label) {
    var pt = { lat: lat, lng: lng, label: label || '' };
    if (which === 'start') state.start = pt; else state.end = pt;

    var marker = which === 'start' ? startMarker : endMarker;
    if (marker) {
      marker.setLatLng([lat, lng]);
      if (label) marker.getPopup().setContent(label);
    } else {
      marker = L.marker([lat, lng], {
        icon: makePin(which === 'start' ? 'pin-start' : 'pin-end', which === 'start' ? 'A' : 'B'),
        draggable: true, autoPan: true
      }).addTo(map).bindPopup(label || 'Point');
      marker.on('dragend', function (e) {
        var ll = e.target.getLatLng();
        setPoint(which, ll.lat, ll.lng, marker.getPopup().getContent());
        labelPoint(which, ll.lat, ll.lng, true);
      });
      if (which === 'start') startMarker = marker; else endMarker = marker;
    }

    $((which === 'start') ? 'startLabel' : 'endLabel').textContent = label || 'Pinned point';
    syncPointControls();
    saveRoute();
    recompute();
  }

  /* Remove a single point without disturbing the other one. */
  function clearPoint(which) {
    if (which === 'start') {
      if (startMarker) { map.removeLayer(startMarker); startMarker = null; }
      state.start = null;
      $('startLabel').textContent = 'Not set';
      setArming('start');
      $('mapHint').textContent = 'Start removed. Tap the map to set a new one.';
    } else {
      if (endMarker) { map.removeLayer(endMarker); endMarker = null; }
      state.end = null;
      $('endLabel').textContent = 'Not set';
      setArming('end');
      $('mapHint').textContent = 'Destination removed. Tap the map to set a new one.';
    }
    syncPointControls();
    saveRoute();
    recompute();
  }

  function labelPoint(which, lat, lng, silent) {
    reverseGeocode(lat, lng).then(function (place) {
      if (which === 'start') { state.start.label = place.name; $('startLabel').textContent = place.name; if (startMarker) startMarker.getPopup().setContent(place.name); }
      else { state.end.label = place.name; $('endLabel').textContent = place.name; if (endMarker) endMarker.getPopup().setContent(place.name); }
      saveRoute();
    });
  }

  function onMapClick(lat, lng) {
    var which = state.arming || 'start';
    setPoint(which, lat, lng, '');
    setArming(which === 'start' ? 'end' : 'start');
  }

  function useMyLocation() {
    if (!navigator.geolocation) { $('mapHint').textContent = 'This browser does not support geolocation.'; return; }
    $('mapHint').textContent = 'Finding your location...';
    navigator.geolocation.getCurrentPosition(function (pos) {
      var lat = pos.coords.latitude, lng = pos.coords.longitude;
      if (meMarker) map.removeLayer(meMarker);
      meMarker = L.marker([lat, lng], { icon: makePin('pin-me', ''), zIndexOffset: 500 }).addTo(map);
      if (meCircle) map.removeLayer(meCircle);
      meCircle = L.circle([lat, lng], { radius: pos.coords.accuracy || 0, color: '#2563eb', fillColor: '#2563eb', fillOpacity: .12, weight: 1 }).addTo(map);

      setPoint('start', lat, lng, 'My location');
      map.setView([lat, lng], 14);
      labelPoint('start', lat, lng);
      $('mapHint').textContent = 'Start set to your location. Now tap the map for your destination.';
    }, function (err) {
      $('mapHint').textContent = err.code === 1
        ? 'Location permission denied. You can still tap the map to set a start.'
        : 'Could not find you. Tap the map to set a start instead.';
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  }

  function haversine(a, b) {
    var R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /* ---------- gas maths: litres = distance / efficiency ---------- */
  function updateGas(distanceKm) {
    var eff = state.efficiency, price = state.price;
    var litres = (eff > 0) ? distanceKm / eff : NaN;
    var cost = isFinite(litres) ? litres * price : NaN;
    $('statLitres').textContent = fmtNum(litres, 1);
    $('statCost').textContent = isFinite(cost) ? fmtNum(cost, 2) : '--';
    $('statFormula').textContent = fmtNum(distanceKm, 1) + ' km \u00F7 ' + fmtNum(eff, 1) + ' km/L';
  }

  var recomputeSeq = 0;
  function recompute() {
    if (!state.start || !state.end) {
      if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
      $('statDistance').textContent = '--';
      $('statLitres').textContent = '--';
      $('statCost').textContent = '--';
      $('statFormula').textContent = 'litres = distance \u00F7 efficiency';
      $('routeWarn').classList.add('hidden');
      return;
    }

    var seq = ++recomputeSeq;
    $('routeWarn').classList.add('hidden');
    var a = state.start, b = state.end;
    var url = OSRM + '/' + a.lng + ',' + a.lat + ';' + b.lng + ',' + b.lat + '?overview=full&geometries=geojson';

    $('mapHint').textContent = 'Calculating route...';

    fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (seq !== recomputeSeq) return;
        if (!data.routes || !data.routes.length) throw new Error('No route found');
        var route = data.routes[0];
        var coords = route.geometry.coordinates.map(function (c) { return [c[1], c[0]]; });
        if (routeLine) map.removeLayer(routeLine);
        routeLine = L.polyline(coords, { color: '#f59e0b', weight: 5, opacity: .9 }).addTo(map);
        map.fitBounds(routeLine.getBounds().pad(0.25));

        var km = route.distance / 1000;
        $('statDistance').textContent = fmtNum(km, 1);
        updateGas(km);
        $('mapHint').textContent = 'Drag either pin to adjust the route.';
      })
      .catch(function () {
        if (seq !== recomputeSeq) return;
        if (routeLine) map.removeLayer(routeLine);
        var straight = L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color: '#f59e0b', weight: 4, dashArray: '8 8', opacity: .9 }).addTo(map);
        routeLine = straight;
        var km = haversine(a, b);
        $('statDistance').textContent = fmtNum(km, 1);
        updateGas(km);
        var w = $('routeWarn');
        w.textContent = 'Routing service unavailable, so this is a straight-line estimate. Real road distance is usually 20-40% longer.';
        w.classList.remove('hidden');
      });
  }

  /* ---------- route persistence ---------- */
  function saveRoute() {
    try {
      localStorage.setItem(ROUTE_KEY, JSON.stringify({
        start: state.start, end: state.end, efficiency: state.efficiency, price: state.price
      }));
    } catch (e) {}
  }

  function loadRoute() {
    try {
      var raw = localStorage.getItem(ROUTE_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (d && typeof d === 'object') {
        state.efficiency = num(d.efficiency) || state.efficiency;
        state.price = isFinite(num(d.price)) ? num(d.price) : state.price;
        $('efficiency').value = state.efficiency;
        $('pricePerL').value = state.price;
        if (d.start && isFinite(d.start.lat)) restorePoint('start', d.start);
        if (d.end && isFinite(d.end.lat)) restorePoint('end', d.end);
      }
    } catch (e) {}
  }

  function restorePoint(which, p) {
    if (which === 'start') { state.start = p; startMarker = null; } else { state.end = p; endMarker = null; }
    setPoint(which, p.lat, p.lng, p.label || 'Saved point');
  }

  function clearRoute() {
    if (startMarker) { map.removeLayer(startMarker); startMarker = null; }
    if (endMarker) { map.removeLayer(endMarker); endMarker = null; }
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    state.start = null; state.end = null;
    $('startLabel').textContent = 'Not set';
    $('endLabel').textContent = 'Not set';
    syncPointControls();
    setArming('start');
    recompute();
  }

  function swapPoints() {
    if (!state.start || !state.end) return;
    var a = state.start, b = state.end;
    if (startMarker) { map.removeLayer(startMarker); startMarker = null; }
    if (endMarker) { map.removeLayer(endMarker); endMarker = null; }
    setPoint('start', b.lat, b.lng, b.label);
    setPoint('end', a.lat, a.lng, a.label);
  }

  /* ---------- init ---------- */
  function init() {
    var stored = null;
    try { stored = localStorage.getItem(THEME_KEY); } catch (e) {}
    applyTheme(stored || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

    initMap();
    loadRoute();
    setArming('start');
    recompute();

    $('themeToggle').addEventListener('click', function () {
      applyTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark');
    });

    $('useMyLocation').addEventListener('click', useMyLocation);
    $('setDestBtn').addEventListener('click', function () { setArming(state.arming === 'end' ? 'start' : 'end'); });
    $('targetStart').addEventListener('click', function () { setArming('start'); });
    $('targetEnd').addEventListener('click', function () { setArming('end'); });
    $('swapBtn').addEventListener('click', swapPoints);
    $('clearRouteBtn').addEventListener('click', clearRoute);
    $('clearStart').addEventListener('click', function () { clearPoint('start'); });
    $('clearEnd').addEventListener('click', function () { clearPoint('end'); });

    $('placeSearch').addEventListener('input', function (e) {
      var v = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { runSearch(v); }, 400);
    });
    $('placeSearch').addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeSuggestions(); $('placeSearch').blur(); }
      if (e.key === 'Enter') {
        e.preventDefault();
        var first = $('suggestions').querySelector('button');
        if (first) first.click();
      }
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#placeSearch') && !e.target.closest('#suggestions')) closeSuggestions();
    });

    $('efficiency').addEventListener('input', function () {
      var v = num($('efficiency').value);
      state.efficiency = v > 0 ? v : 0;
      saveRoute();
      var d = num($('statDistance').textContent);
      if (isFinite(d)) updateGas(d);
    });
    $('pricePerL').addEventListener('input', function () {
      var v = num($('pricePerL').value);
      state.price = v >= 0 ? v : 0;
      saveRoute();
      var d = num($('statDistance').textContent);
      if (isFinite(d)) updateGas(d);
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
