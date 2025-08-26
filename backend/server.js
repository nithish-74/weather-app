import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import fetch from 'node-fetch';
import Database from 'better-sqlite3';
import dayjs from 'dayjs';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// SQLite init
const db = new Database('weather.db');
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS queries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  input_text TEXT NOT NULL,
  resolved_name TEXT,
  latitude REAL,
  longitude REAL,
  date_from TEXT,
  date_to TEXT,
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`);

// Health
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Geocode via Nominatim
app.get('/api/geocode', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query || String(query).trim().length === 0) {
      return res.status(400).json({ error: 'Missing query parameter q' });
    }
    // Prefer Open-Meteo Geocoding (reliable, no UA requirement)
    try {
      const om = new URL('https://geocoding-api.open-meteo.com/v1/search');
      om.searchParams.set('name', String(query));
      om.searchParams.set('count', '5');
      om.searchParams.set('language', 'en');
      om.searchParams.set('format', 'json');
      const omResp = await fetch(om.toString());
      if (omResp.ok) {
        const omData = await omResp.json();
        const results = (omData?.results || []).map(r => ({
          display_name: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
          lat: r.latitude,
          lon: r.longitude
        }));
        if (results.length > 0) return res.json(results);
      }
    } catch {}

    // Fallback: Nominatim
    try {
      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.set('q', String(query));
      url.searchParams.set('format', 'json');
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('limit', '5');
      const resp = await fetch(url.toString(), { headers: { 'User-Agent': 'weather-app-assessment/1.0' } });
      if (resp.ok) {
        const data = await resp.json();
        return res.json(data);
      }
    } catch {}

    return res.json([]);
  } catch (err) {
    // Return empty list instead of 500 to keep UX smooth
    res.json([]);
  }
});

// Current weather and 5-day forecast via Open-Meteo
app.get('/api/weather', async (req, res) => {
  try {
    const lat = req.query.lat;
    const lon = req.query.lon;
    if (!lat || !lon) {
      return res.status(400).json({ error: 'lat and lon are required' });
    }
    const currentUrl = new URL('https://api.open-meteo.com/v1/forecast');
    currentUrl.searchParams.set('latitude', String(lat));
    currentUrl.searchParams.set('longitude', String(lon));
    currentUrl.searchParams.set('current_weather', 'true');
    currentUrl.searchParams.set('hourly', 'temperature_2m,relative_humidity_2m,precipitation,weathercode');
    currentUrl.searchParams.set('daily', 'weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum');
    currentUrl.searchParams.set('forecast_days', '5');
    currentUrl.searchParams.set('timezone', 'auto');

    const resp = await fetch(currentUrl.toString());
    if (!resp.ok) {
      return res.status(502).json({ error: 'Upstream weather error' });
    }
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Weather fetch failed', details: String(err) });
  }
});

// Create a saved query with date range temperatures (archive API)
app.post('/api/queries', async (req, res) => {
  try {
    const { location, dateFrom, dateTo } = req.body || {};
    if (!location || !String(location).trim()) {
      return res.status(400).json({ error: 'location is required' });
    }
    // validate dates
    const start = dayjs(dateFrom);
    const end = dayjs(dateTo);
    if (!start.isValid() || !end.isValid() || end.isBefore(start)) {
      return res.status(400).json({ error: 'Invalid date range' });
    }
    // geocode
    const geoUrl = new URL('https://nominatim.openstreetmap.org/search');
    geoUrl.searchParams.set('q', String(location));
    geoUrl.searchParams.set('format', 'json');
    geoUrl.searchParams.set('addressdetails', '1');
    geoUrl.searchParams.set('limit', '1');
    const geoResp = await fetch(geoUrl.toString(), { headers: { 'User-Agent': 'weather-app-assessment/1.0' } });
    const geo = await geoResp.json();
    if (!Array.isArray(geo) || geo.length === 0) {
      return res.status(404).json({ error: 'Location not found' });
    }
    const pick = geo[0];
    const lat = Number(pick.lat);
    const lon = Number(pick.lon);
    // archive weather
    const arch = new URL('https://archive-api.open-meteo.com/v1/archive');
    arch.searchParams.set('latitude', String(lat));
    arch.searchParams.set('longitude', String(lon));
    arch.searchParams.set('start_date', start.format('YYYY-MM-DD'));
    arch.searchParams.set('end_date', end.format('YYYY-MM-DD'));
    arch.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_sum');
    arch.searchParams.set('timezone', 'auto');
    const archResp = await fetch(arch.toString());
    const archData = await archResp.json();

    const now = dayjs().toISOString();
    const info = {
      input_text: String(location),
      resolved_name: pick.display_name,
      latitude: lat,
      longitude: lon,
      date_from: start.format('YYYY-MM-DD'),
      date_to: end.format('YYYY-MM-DD'),
      result_json: JSON.stringify(archData),
      created_at: now,
      updated_at: now
    };
    const stmt = db.prepare(`INSERT INTO queries (input_text, resolved_name, latitude, longitude, date_from, date_to, result_json, created_at, updated_at)
      VALUES (@input_text, @resolved_name, @latitude, @longitude, @date_from, @date_to, @result_json, @created_at, @updated_at)`);
    const result = stmt.run(info);
    res.status(201).json({ id: result.lastInsertRowid, ...info });
  } catch (err) {
    res.status(500).json({ error: 'Create failed', details: String(err) });
  }
});

// Read all queries
app.get('/api/queries', (req, res) => {
  const rows = db.prepare('SELECT * FROM queries ORDER BY created_at DESC').all();
  res.json(rows.map(r => ({ ...r, result_json: JSON.parse(r.result_json || '{}') })));
});

// Read one
app.get('/api/queries/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM queries WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ ...row, result_json: JSON.parse(row.result_json || '{}') });
});

// Update (allows changing location or date range; refreshes data)
app.put('/api/queries/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM queries WHERE id=?').get(id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const location = req.body.location ?? existing.input_text;
    const dateFrom = req.body.dateFrom ?? existing.date_from;
    const dateTo = req.body.dateTo ?? existing.date_to;

    const start = dayjs(dateFrom);
    const end = dayjs(dateTo);
    if (!start.isValid() || !end.isValid() || end.isBefore(start)) {
      return res.status(400).json({ error: 'Invalid date range' });
    }

    // geocode (only if changed)
    let pick = { display_name: existing.resolved_name, lat: existing.latitude, lon: existing.longitude };
    if (String(location) !== existing.input_text) {
      const geoUrl = new URL('https://nominatim.openstreetmap.org/search');
      geoUrl.searchParams.set('q', String(location));
      geoUrl.searchParams.set('format', 'json');
      geoUrl.searchParams.set('addressdetails', '1');
      geoUrl.searchParams.set('limit', '1');
      const geoResp = await fetch(geoUrl.toString(), { headers: { 'User-Agent': 'weather-app-assessment/1.0' } });
      const geo = await geoResp.json();
      if (!Array.isArray(geo) || geo.length === 0) {
        return res.status(404).json({ error: 'Location not found' });
      }
      pick = geo[0];
    }
    const lat = Number(pick.lat);
    const lon = Number(pick.lon);
    const arch = new URL('https://archive-api.open-meteo.com/v1/archive');
    arch.searchParams.set('latitude', String(lat));
    arch.searchParams.set('longitude', String(lon));
    arch.searchParams.set('start_date', start.format('YYYY-MM-DD'));
    arch.searchParams.set('end_date', end.format('YYYY-MM-DD'));
    arch.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_sum');
    arch.searchParams.set('timezone', 'auto');
    const archResp = await fetch(arch.toString());
    const archData = await archResp.json();

    const now = dayjs().toISOString();
    db.prepare(`UPDATE queries SET input_text=?, resolved_name=?, latitude=?, longitude=?, date_from=?, date_to=?, result_json=?, updated_at=? WHERE id=?`)
      .run(String(location), pick.display_name, lat, lon, start.format('YYYY-MM-DD'), end.format('YYYY-MM-DD'), JSON.stringify(archData), now, id);
    const row = db.prepare('SELECT * FROM queries WHERE id=?').get(id);
    res.json({ ...row, result_json: JSON.parse(row.result_json || '{}') });
  } catch (err) {
    res.status(500).json({ error: 'Update failed', details: String(err) });
  }
});

// Delete
app.delete('/api/queries/:id', (req, res) => {
  const info = db.prepare('DELETE FROM queries WHERE id=?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// Export JSON
app.get('/api/export.json', (req, res) => {
  const rows = db.prepare('SELECT * FROM queries ORDER BY created_at DESC').all();
  const out = rows.map(r => ({ ...r, result_json: JSON.parse(r.result_json || '{}') }));
  res.setHeader('Content-Disposition', 'attachment; filename="weather_export.json"');
  res.json(out);
});

// Export CSV (simple flat export)
app.get('/api/export.csv', (req, res) => {
  const rows = db.prepare('SELECT * FROM queries ORDER BY created_at DESC').all();
  const header = ['id','input_text','resolved_name','latitude','longitude','date_from','date_to','created_at','updated_at'];
  const csv = [header.join(','), ...rows.map(r => header.map(k => JSON.stringify(r[k] ?? '')).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="weather_export.csv"');
  res.send(csv);
});

// Serve static frontend
app.use('/', express.static('frontend'));

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running on http://localhost:${PORT}`);
});


