const geocodeResultsEl = document.getElementById('geocodeResults');
const weatherEl = document.getElementById('weather');

document.getElementById('infoBtn').addEventListener('click', () => {
  document.getElementById('infoDialog').showModal();
});
document.getElementById('closeInfo').addEventListener('click', () => {
  document.getElementById('infoDialog').close();
});

document.getElementById('searchBtn').addEventListener('click', async () => {
  const q = document.getElementById('locationInput').value.trim();
  if (!q) return;
  geocodeResultsEl.textContent = 'Searching...';
  let results = [];
  // Try backend first
  try {
    const resp = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
    if (resp.ok) results = await resp.json();
  } catch {}
  // Client-side fallback: Open-Meteo geocoding direct
  if (!Array.isArray(results) || results.length === 0) {
    try {
      const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
      url.searchParams.set('name', q);
      url.searchParams.set('count', '5');
      url.searchParams.set('language', 'en');
      url.searchParams.set('format', 'json');
      const resp2 = await fetch(url.toString());
      if (resp2.ok) {
        const data2 = await resp2.json();
        results = (data2?.results || []).map(r => ({
          display_name: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
          lat: r.latitude,
          lon: r.longitude
        }));
      }
    } catch {}
  }
  if (!Array.isArray(results) || results.length === 0) {
    geocodeResultsEl.textContent = 'No results. Try a more specific query (e.g., "New York, US").';
    return;
  }
  geocodeResultsEl.innerHTML = results
    .map((d, idx) => `<button data-idx="${idx}">${d.display_name}</button>`) 
    .join('');
  Array.from(geocodeResultsEl.querySelectorAll('button')).forEach((btn) => {
    btn.addEventListener('click', () => {
      const pick = results[Number(btn.dataset.idx)];
      loadWeather(Number(pick.lat), Number(pick.lon), pick.display_name);
    });
  });
});

document.getElementById('geoBtn').addEventListener('click', () => {
  if (!navigator.geolocation) return alert('Geolocation not supported');
  navigator.geolocation.getCurrentPosition((pos) => {
    const { latitude, longitude } = pos.coords;
    loadWeather(latitude, longitude, 'Your Location');
  }, (err) => alert('Geolocation error: ' + err.message));
});

async function loadWeather(lat, lon, label) {
  weatherEl.textContent = `Loading weather for ${label}...`;
  try {
    const resp = await fetch(`/api/weather?lat=${lat}&lon=${lon}`);
    if (!resp.ok) {
      const msg = await resp.text().catch(() => 'Weather fetch failed');
      throw new Error(msg);
    }
    const data = await resp.json();
    renderWeather(data, label);
  } catch (e) {
    // Client-side fallback: call Open-Meteo directly
    try {
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.searchParams.set('latitude', String(lat));
      url.searchParams.set('longitude', String(lon));
      url.searchParams.set('current_weather', 'true');
      url.searchParams.set('hourly', 'temperature_2m,relative_humidity_2m,precipitation,weathercode');
      url.searchParams.set('daily', 'weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum');
      url.searchParams.set('forecast_days', '5');
      url.searchParams.set('timezone', 'auto');
      const resp2 = await fetch(url.toString());
      if (!resp2.ok) throw new Error('Upstream weather error');
      const data2 = await resp2.json();
      renderWeather(data2, label);
    } catch (e2) {
      weatherEl.textContent = 'Could not load weather. ' + (e2?.message || 'Please try again.');
    }
  }
}

function renderWeather(data, label) {
  const cw = data.current_weather;
  const daily = data.daily;
  const dailyDates = daily?.time || [];
  const currentIcon = codeToIcon(cw?.weathercode);
  const rows = dailyDates.map((date, i) => {
    const min = daily.temperature_2m_min?.[i];
    const max = daily.temperature_2m_max?.[i];
    const p = daily.precipitation_sum?.[i];
    const icon = codeToIcon(daily.weathercode?.[i]);
    return `<div class="card"><div class="date">${date}</div><div class="icon">${icon}</div><div>Min ${min}°C / Max ${max}°C</div><div>Precip ${p}mm</div></div>`;
  }).join('');

  weatherEl.innerHTML = `
    <h3>${label}</h3>
    <div class="current">Current: <span class="icon">${currentIcon}</span> ${cw?.temperature}°C, wind ${cw?.windspeed} km/h</div>
    <h4>5-Day Forecast</h4>
    <div class="forecast-grid">${rows}</div>
  `;
}

// Map Open-Meteo weathercode to simple icons
function codeToIcon(code) {
  switch (Number(code)) {
    case 0: return '☀️'; // Clear
    case 1:
    case 2: return '🌤️'; // Mainly clear/partly cloudy
    case 3: return '☁️'; // Overcast
    case 45:
    case 48: return '🌫️'; // Fog
    case 51:
    case 53:
    case 55: return '🌦️'; // Drizzle
    case 61:
    case 63:
    case 65: return '🌧️'; // Rain
    case 71:
    case 73:
    case 75: return '🌨️'; // Snow
    case 77: return '🌨️'; // Snow grains
    case 80:
    case 81:
    case 82: return '⛈️'; // Rain showers
    case 85:
    case 86: return '🌨️'; // Snow showers
    case 95: return '⛈️'; // Thunderstorm
    case 96:
    case 99: return '⛈️'; // Thunderstorm with hail
    default: return '🌡️';
  }
}

// CRUD UI
document.getElementById('crudCreate').addEventListener('click', async () => {
  const location = document.getElementById('crudLocation').value.trim();
  const dateFrom = document.getElementById('crudFrom').value;
  const dateTo = document.getElementById('crudTo').value;
  if (!location || !dateFrom || !dateTo) return alert('Enter location and date range');
  const resp = await fetch('/api/queries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location, dateFrom, dateTo }) });
  const data = await resp.json();
  if (!resp.ok) return alert(data.error || 'Create failed');
  await refreshList();
});

document.getElementById('crudRefresh').addEventListener('click', refreshList);

async function refreshList() {
  const listEl = document.getElementById('crudList');
  listEl.innerHTML = 'Loading...';
  const resp = await fetch('/api/queries');
  const rows = await resp.json();
  if (!Array.isArray(rows) || rows.length === 0) { listEl.innerHTML = 'No saved queries'; return; }
  listEl.innerHTML = rows.map(r => renderRow(r)).join('');
  bindRowHandlers(rows);
}

function renderRow(r) {
  return `
  <div class="row" data-id="${r.id}">
    <div><strong>${r.input_text}</strong><br/><small>${r.date_from} → ${r.date_to}</small></div>
    <div class="row-actions">
      <button class="btn-view">View</button>
      <button class="btn-edit">Edit</button>
      <button class="btn-del">Delete</button>
    </div>
  </div>`;
}

function bindRowHandlers(rows) {
  const listEl = document.getElementById('crudList');
  listEl.querySelectorAll('.btn-view').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.row').dataset.id;
      const resp = await fetch(`/api/queries/${id}`);
      const r = await resp.json();
      alert(`Saved query for ${r.resolved_name}\nFrom ${r.date_from} to ${r.date_to}`);
    });
  });
  listEl.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.row').dataset.id;
      const location = prompt('New location (leave blank to keep)');
      const dateFrom = prompt('New start date YYYY-MM-DD (leave blank to keep)');
      const dateTo = prompt('New end date YYYY-MM-DD (leave blank to keep)');
      const body = {};
      if (location) body.location = location;
      if (dateFrom) body.dateFrom = dateFrom;
      if (dateTo) body.dateTo = dateTo;
      const resp = await fetch(`/api/queries/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await resp.json();
      if (!resp.ok) return alert(data.error || 'Update failed');
      await refreshList();
    });
  });
  listEl.querySelectorAll('.btn-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.row').dataset.id;
      if (!confirm('Delete this record?')) return;
      const resp = await fetch(`/api/queries/${id}`, { method: 'DELETE' });
      const data = await resp.json();
      if (!resp.ok) return alert(data.error || 'Delete failed');
      await refreshList();
    });
  });
}

// initial
refreshList();


