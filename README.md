## Weather App (Assessment)

Simple Node.js + Express + SQLite weather app.

### Features
- Enter location (city/zip/landmark) via Nominatim geocoding
- Current weather + 5-day forecast (Open-Meteo)
- Use device geolocation
- Persist queries with date ranges (SQLite) and full CRUD
- Export saved data as JSON/CSV
- Info dialog linking to PM Accelerator

### Requirements
- Node.js 18+

### Setup
1) Install dependencies
```
npm install
```
2) Start the app
```
npm start
```
3) Open in browser
```
http://localhost:3000
```

### Deploy (Render)
1) Push to GitHub (public repo)
2) Add `render.yaml` to repo (already included)
3) In Render: New + Blueprint > connect your repo > deploy
   - It will build with `npm install` and run `npm start`
   - Healthcheck: `/api/health`

### Notes
- Database file `weather.db` is created automatically in project root
- APIs: Open-Meteo, Nominatim (OpenStreetMap)


