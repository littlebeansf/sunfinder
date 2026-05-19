import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { insertSavedLocationSchema } from "@shared/schema";
// Node 18+ has native fetch — no import needed

// WMO weather code descriptions
const WMO_CODES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  71: "Slight snow",
  73: "Moderate snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

function calcSunnyScore(weatherCode: number, cloudCover: number, precipitation: number): number {
  let score = 100;
  // Penalty for weather code
  if (weatherCode === 0) score -= 0;
  else if (weatherCode <= 2) score -= 10;
  else if (weatherCode === 3) score -= 35;
  else if (weatherCode <= 48) score -= 50;
  else if (weatherCode <= 55) score -= 60;
  else if (weatherCode <= 65) score -= 75;
  else if (weatherCode <= 82) score -= 80;
  else score -= 90;
  // Penalty for cloud cover
  score -= (cloudCover / 100) * 30;
  // Penalty for precipitation
  score -= Math.min(precipitation * 20, 20);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Generate candidate spots in a grid around the user's location (up to ~400km)
function generateCandidates(lat: number, lon: number) {
  const offsets = [
    { dlat: 1.5, dlon: 0, label: "North" },
    { dlat: -1.5, dlon: 0, label: "South" },
    { dlat: 0, dlon: 2.0, label: "East" },
    { dlat: 0, dlon: -2.0, label: "West" },
    { dlat: 1.5, dlon: 2.0, label: "Northeast" },
    { dlat: 1.5, dlon: -2.0, label: "Northwest" },
    { dlat: -1.5, dlon: 2.0, label: "Southeast" },
    { dlat: -1.5, dlon: -2.0, label: "Southwest" },
    { dlat: 3.0, dlon: 0, label: "Far North" },
    { dlat: -3.0, dlon: 0, label: "Far South" },
    { dlat: 0, dlon: 4.0, label: "Far East" },
    { dlat: 0, dlon: -4.0, label: "Far West" },
    { dlat: 3.0, dlon: 3.0, label: "Far Northeast" },
    { dlat: -3.0, dlon: 3.0, label: "Far Southeast" },
    { dlat: -3.0, dlon: -3.0, label: "Far Southwest" },
    { dlat: 3.0, dlon: -3.0, label: "Far Northwest" },
  ];
  return offsets.map((o) => ({
    lat: Math.max(-89, Math.min(89, lat + o.dlat)),
    lon: ((lon + o.dlon + 180) % 360) - 180,
    label: o.label,
  }));
}

async function reverseGeocode(lat: number, lon: number): Promise<{ name: string; region: string; country: string }> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10`;
    const res = await fetch(url, { headers: { "User-Agent": "SunFinder/1.0" } });
    const data = (await res.json()) as any;
    const address = data.address || {};
    const name =
      address.city || address.town || address.village || address.municipality || address.county || "Unknown";
    const region = address.state || address.county || "";
    const country = address.country_code?.toUpperCase() || address.country || "";
    return { name, region, country };
  } catch {
    return { name: "Unknown", region: "", country: "" };
  }
}

async function fetchWeatherForPoints(
  points: Array<{ lat: number; lon: number; label: string }>
) {
  const lats = points.map((p) => p.lat.toFixed(4)).join(",");
  const lons = points.map((p) => p.lon.toFixed(4)).join(",");
  const url =
    `https://api.open-meteo.com/v1/forecast?` +
    `latitude=${lats}&longitude=${lons}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_speed_10m,is_day` +
    `&timezone=auto&forecast_days=1`;

  const res = await fetch(url);
  const json = (await res.json()) as any;
  // open-meteo returns array if multiple
  const arr = Array.isArray(json) ? json : [json];
  return arr;
}

export async function registerRoutes(httpServer: Server, app: Express) {
  // GET current weather for user location
  app.get("/api/weather/current", async (req, res) => {
    const lat = parseFloat(req.query.lat as string);
    const lon = parseFloat(req.query.lon as string);
    if (isNaN(lat) || isNaN(lon)) return res.status(400).json({ error: "Invalid coordinates" });

    try {
      const url =
        `https://api.open-meteo.com/v1/forecast?` +
        `latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_speed_10m,is_day` +
        `&timezone=auto&forecast_days=1`;
      const weatherRes = await fetch(url);
      const weatherJson = (await weatherRes.json()) as any;
      const c = weatherJson.current;

      const geo = await reverseGeocode(lat, lon);
      const weatherCode = c.weather_code ?? 0;
      const cloudCover = c.cloud_cover ?? 0;
      const precipitation = c.precipitation ?? 0;

      res.json({
        lat,
        lon,
        name: geo.name,
        region: geo.region,
        country: geo.country,
        temperature: Math.round(c.temperature_2m),
        feelsLike: Math.round(c.apparent_temperature),
        weatherCode,
        weatherDesc: WMO_CODES[weatherCode] || "Unknown",
        cloudCover,
        windspeed: Math.round(c.wind_speed_10m),
        humidity: c.relative_humidity_2m,
        precipitation,
        sunnyScore: calcSunnyScore(weatherCode, cloudCover, precipitation),
        isNight: c.is_day === 0,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch weather" });
    }
  });

  // GET nearest sunny spots
  app.get("/api/weather/sunny-spots", async (req, res) => {
    const lat = parseFloat(req.query.lat as string);
    const lon = parseFloat(req.query.lon as string);
    if (isNaN(lat) || isNaN(lon)) return res.status(400).json({ error: "Invalid coordinates" });

    try {
      const candidates = generateCandidates(lat, lon);
      const weatherArr = await fetchWeatherForPoints(candidates);

      // Geocode all candidates in parallel
      const geoResults = await Promise.all(
        candidates.map((c) => reverseGeocode(c.lat, c.lon))
      );

      const spots = candidates
        .map((candidate, i) => {
          const w = weatherArr[i];
          if (!w || !w.current) return null;
          const c = w.current;
          const weatherCode = c.weather_code ?? 0;
          const cloudCover = c.cloud_cover ?? 0;
          const precipitation = c.precipitation ?? 0;
          const temperature = Math.round(c.temperature_2m);
          const sunnyScore = calcSunnyScore(weatherCode, cloudCover, precipitation);
          const geo = geoResults[i];
          const distanceKm = Math.round(haversineKm(lat, lon, candidate.lat, candidate.lon));

          // Generate a short place description
          const desc = generateDescription(geo.name, weatherCode, temperature, cloudCover, sunnyScore);

          return {
            name: geo.name !== "Unknown" ? geo.name : candidate.label,
            region: geo.region,
            country: geo.country,
            lat: candidate.lat,
            lon: candidate.lon,
            distanceKm,
            weather: {
              lat: candidate.lat,
              lon: candidate.lon,
              name: geo.name,
              country: geo.country,
              temperature,
              feelsLike: Math.round(c.apparent_temperature),
              weatherCode,
              weatherDesc: WMO_CODES[weatherCode] || "Unknown",
              cloudCover,
              windspeed: Math.round(c.wind_speed_10m),
              humidity: c.relative_humidity_2m,
              precipitation,
              sunnyScore,
              isNight: c.is_day === 0,
            },
            description: desc,
          };
        })
        .filter(Boolean)
        .sort((a: any, b: any) => b.weather.sunnyScore - a.weather.sunnyScore)
        .slice(0, 8);

      res.json(spots);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch sunny spots" });
    }
  });

  // Geocode a search query
  app.get("/api/geocode", async (req, res) => {
    const q = req.query.q as string;
    if (!q) return res.status(400).json({ error: "Missing query" });
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`;
      const r = await fetch(url, { headers: { "User-Agent": "SunFinder/1.0" } });
      const data = (await r.json()) as any[];
      const results = data.map((item: any) => ({
        name: item.display_name,
        lat: parseFloat(item.lat),
        lon: parseFloat(item.lon),
      }));
      res.json(results);
    } catch {
      res.status(500).json({ error: "Geocoding failed" });
    }
  });

  // Saved locations CRUD
  app.get("/api/locations", (_req, res) => {
    res.json(storage.getSavedLocations());
  });

  app.post("/api/locations", (req, res) => {
    const parsed = insertSavedLocationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const loc = storage.saveLocation(parsed.data);
    res.json(loc);
  });

  app.delete("/api/locations/:id", (req, res) => {
    storage.deleteLocation(parseInt(req.params.id));
    res.json({ success: true });
  });
}

function generateDescription(
  name: string,
  code: number,
  temp: number,
  clouds: number,
  score: number
): string {
  if (score >= 80) {
    return `Beautiful sunshine with ${temp}°C — perfect for a day trip outdoors.`;
  } else if (score >= 60) {
    return `Mostly clear skies at ${temp}°C with just ${clouds}% cloud cover.`;
  } else if (score >= 40) {
    return `Partly cloudy at ${temp}°C — decent weather with some sun breaks.`;
  } else if (score >= 20) {
    return `${WMO_CODES[code] || "Mixed conditions"} at ${temp}°C — not ideal, but worth checking.`;
  } else {
    return `${WMO_CODES[code] || "Poor conditions"} at ${temp}°C — probably not worth the trip.`;
  }
}
