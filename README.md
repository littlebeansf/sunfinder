# ☀️ SunFinder

> **Escape the clouds.** Find the nearest sunny spots around you in real time.

Built for Lake Constance area residents who are tired of overcast skies — SunFinder shows you where the sun is shining within ~400 km of your location, right now.

![SunFinder Screenshot](https://raw.githubusercontent.com/littlebeansf/sunfinder/main/screenshot.png)

## Features

- 📍 **Auto-detect location** via browser geolocation or manual search
- 🗺️ **Interactive map** (Leaflet + OpenStreetMap) with colored markers ranked by sunshine score
- ☀️ **Sunshine score** (0–100) based on weather code, cloud cover, and precipitation
- 🌡️ **Live weather** for your location and up to 8 nearby spots
- 📌 **Save locations** for quick re-use
- 🌙 **Dark mode** with system preference detection
- 📱 **Fully responsive** — works on mobile, tablet, and desktop

## Tech Stack

- **Frontend:** React + TypeScript + Tailwind CSS + shadcn/ui + Leaflet/react-leaflet
- **Backend:** Express.js + SQLite (better-sqlite3 + Drizzle ORM)
- **Weather API:** [Open-Meteo](https://open-meteo.com/) (free, no API key needed)
- **Geocoding:** [Nominatim](https://nominatim.openstreetmap.org/) (OpenStreetMap)
- **Build:** Vite + esbuild

## Local Development

```bash
npm install
npm run dev
```

App runs at `http://localhost:5000`.

## How It Works

1. Enter or detect your location
2. The app generates 16 candidate points in a grid around you (out to ~450 km)
3. Open-Meteo returns weather for all points in one batch request
4. Each point is reverse-geocoded to find the nearest city/town
5. Spots are ranked by sunshine score and the top 8 are displayed
6. Click any spot card to fly to it on the map

## Sunshine Score Formula

```
score = 100
  - weather_code_penalty (0–90)
  - (cloud_cover / 100) * 30
  - min(precipitation * 20, 20)
```

## Credits

- Weather data: [Open-Meteo](https://open-meteo.com/)
- Geocoding: [Nominatim / OpenStreetMap](https://nominatim.openstreetmap.org/)
- Maps: [Leaflet](https://leafletjs.com/) + [OpenStreetMap](https://www.openstreetmap.org/)

---

Made with ☀️ by [littlebeansf](https://github.com/littlebeansf)
