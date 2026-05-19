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

// Generate candidate spots scaled to radiusKm (default 200km)
function generateCandidates(lat: number, lon: number, radiusKm = 200) {
  const latPerKm = 1 / 111;
  const lonPerKm = 1 / (111 * Math.cos((lat * Math.PI) / 180));
  const near = radiusKm * 0.4;
  const mid  = radiusKm * 0.7;
  const far  = radiusKm * 1.0;
  const rings = [
    { dlat:  near * latPerKm, dlon: 0,                    label: "North" },
    { dlat: -near * latPerKm, dlon: 0,                    label: "South" },
    { dlat: 0,                dlon:  near * lonPerKm,     label: "East" },
    { dlat: 0,                dlon: -near * lonPerKm,     label: "West" },
    { dlat:  mid * latPerKm,  dlon:  mid * lonPerKm,      label: "Northeast" },
    { dlat:  mid * latPerKm,  dlon: -mid * lonPerKm,      label: "Northwest" },
    { dlat: -mid * latPerKm,  dlon:  mid * lonPerKm,      label: "Southeast" },
    { dlat: -mid * latPerKm,  dlon: -mid * lonPerKm,      label: "Southwest" },
    { dlat:  far * latPerKm,  dlon: 0,                    label: "Far North" },
    { dlat: -far * latPerKm,  dlon: 0,                    label: "Far South" },
    { dlat: 0,                dlon:  far * lonPerKm,      label: "Far East" },
    { dlat: 0,                dlon: -far * lonPerKm,      label: "Far West" },
    { dlat:  far * 0.7 * latPerKm, dlon:  far * 0.7 * lonPerKm, label: "Far Northeast" },
    { dlat: -far * 0.7 * latPerKm, dlon:  far * 0.7 * lonPerKm, label: "Far Southeast" },
    { dlat: -far * 0.7 * latPerKm, dlon: -far * 0.7 * lonPerKm, label: "Far Southwest" },
    { dlat:  far * 0.7 * latPerKm, dlon: -far * 0.7 * lonPerKm, label: "Far Northwest" },
  ];
  return rings.map((o) => ({
    lat: Math.max(-89, Math.min(89, lat + o.dlat)),
    lon: ((lon + o.dlon + 180) % 360) - 180,
    label: o.label,
  }));
}

async function reverseGeocode(lat: number, lon: number): Promise<{ name: string; region: string; country: string }> {
  // pickName: only settlement-level names qualify — NO county/state/region.
  // Omitting those forces the cascade to run the spiral rescue for lake/open-country coords,
  // which finds the actual nearest town (e.g. "Arbon" instead of "Thurgau").
  const pickName = (address: any): string | null => {
    return address.city || address.town || address.village ||
           address.municipality || address.suburb || address.hamlet ||
           address.locality || address.quarter || address.neighbourhood || null;
  };
  // Broad area names that should NOT short-circuit the spiral rescue.
  // Extend this list as needed for other regions.
  const BROAD_AREA_NAMES = new Set([
    "Thurgau", "Schaffhausen", "St. Gallen", "Zürich", "Zug", "Aargau",
    "Graubünden", "Glarus", "Schwyz", "Uri", "Nidwalden", "Obwalden",
    "Luzern", "Bern", "Solothurn", "Basel", "Appenzell", "Fribourg",
    "Valais", "Vaud", "Genève", "Neuchâtel", "Jura", "Ticino",
    "Baden-Württemberg", "Bayern", "Austria", "Vorarlberg", "Tirol",
    "Switzerland", "Germany", "France", "Italy", "Liechtenstein",
    "Bodensee", "Lake Constance", "Rhein", "Rhine",
  ]);
  try {
    // First attempt: zoom=10 (city/town level)
    const url1 = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10&accept-language=en`;
    const res1 = await fetch(url1, { headers: { "User-Agent": "SunFinder/1.0 (weather app)" } });
    const data1 = (await res1.json()) as any;
    const address1 = data1.address || {};
    const region = address1.state || address1.county || address1.state_district || "";
    const country = address1.country_code?.toUpperCase() || address1.country || "";
    const name1 = pickName(address1);
    if (name1 && name1 !== "Unknown") return { name: name1, region, country };

    // Rescue: use the first segment of display_name (usually the place name),
    // but skip it if it resolves to a broad area/canton/country name.
    if (data1.display_name) {
      const firstName = data1.display_name.split(",")[0].trim();
      if (firstName && firstName.length > 0 && !BROAD_AREA_NAMES.has(firstName)) {
        return { name: firstName, region, country };
      }
    }

    // Second attempt: zoom=8 — only accept if it's more specific than a broad area name.
    // For lake/open-country coords, zoom=8 often returns a canton which we must skip.
    const url2 = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=8&accept-language=en`;
    const res2 = await fetch(url2, { headers: { "User-Agent": "SunFinder/1.0 (weather app)" } });
    const data2 = (await res2.json()) as any;
    const address2 = data2.address || {};
    const name2raw = address2.county || address2.state_district || null; // skip bare state
    const region2 = address2.state || address2.county || "";
    const country2 = address2.country_code?.toUpperCase() || address2.country || "";
    if (name2raw && !BROAD_AREA_NAMES.has(name2raw)) return { name: name2raw, region: region2, country: country2 };
    if (data2.display_name) {
      const firstName = data2.display_name.split(",")[0].trim();
      if (firstName && !BROAD_AREA_NAMES.has(firstName)) return { name: firstName, region: region2, country: country2 };
    }

    // Third attempt: zoom=13 (street/suburb level — catches Swiss towns that zoom=10 misses)
    const url3 = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=13&accept-language=en`;
    const res3 = await fetch(url3, { headers: { "User-Agent": "SunFinder/1.0 (weather app)" } });
    const data3 = (await res3.json()) as any;
    const address3 = data3.address || {};
    const name3 = pickName(address3);
    const region3 = address3.state || address3.county || "";
    const country3 = address3.country_code?.toUpperCase() || address3.country || "";
    if (name3 && name3 !== "Unknown") return { name: name3, region: region3, country: country3 };
    if (data3.display_name) {
      const firstName = data3.display_name.split(",")[0].trim();
      if (firstName && firstName.length > 1 && !BROAD_AREA_NAMES.has(firstName)) {
        return { name: firstName, region: region3, country: country3 };
      }
    }

    // Final rescue: spiral outward in small steps to find nearest named settlement
    // Handles coords that land in lakes, seas, or open countryside
    const offsets = [
      [0.03, 0], [-0.03, 0], [0, 0.04], [0, -0.04],
      [0.03, 0.04], [-0.03, 0.04], [0.03, -0.04], [-0.03, -0.04],
      [0.06, 0], [-0.06, 0], [0, 0.08], [0, -0.08],
    ];
    for (const [dLat, dLon] of offsets) {
      try {
        const oUrl = `https://nominatim.openstreetmap.org/reverse?lat=${lat+dLat}&lon=${lon+dLon}&format=json&zoom=13&accept-language=en`;
        const oRes = await fetch(oUrl, { headers: { "User-Agent": "SunFinder/1.0 (weather app)" } });
        const oData = (await oRes.json()) as any;
        const oAddr = oData.address || {};
        const oName = pickName(oAddr);
        if (oName && oName !== "Unknown") {
          return {
            name: oName,
            region: oAddr.state || oAddr.county || "",
            country: oAddr.country_code?.toUpperCase() || "",
          };
        }
        // display_name first segment rescue — skip broad area names
        if (oData.display_name) {
          const fn = oData.display_name.split(",")[0].trim();
          if (fn && fn.length > 1 && !BROAD_AREA_NAMES.has(fn)) {
            return { name: fn, region: oAddr.state || "", country: oAddr.country_code?.toUpperCase() || "" };
          }
        }
      } catch { /* continue */ }
    }

    // Absolute final fallback: coordinate string
    return { name: `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`, region: "", country: "" };
  } catch {
    return { name: `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`, region: "", country: "" };
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
        `&daily=sunrise,sunset&timezone=auto&forecast_days=2`;
      const weatherRes = await fetch(url);
      const weatherJson = (await weatherRes.json()) as any;
      const c = weatherJson.current;
      // Next sunrise: today's if not yet passed, otherwise tomorrow's
      const sunriseArr: string[] = weatherJson.daily?.sunrise || [];
      const now = Date.now();
      const nextSunrise = sunriseArr.map((s: string) => new Date(s).getTime()).find((t: number) => t > now) || null;

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
        nextSunrise,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch weather" });
    }
  });

  // GET nearest sunny spots
  app.get("/api/weather/sunny-spots", async (req, res) => {
    const lat = parseFloat(req.query.lat as string);
    const lon = parseFloat(req.query.lon as string);
    const radiusKm = Math.max(50, Math.min(500, parseFloat((req.query.radius as string) || "200")));
    if (isNaN(lat) || isNaN(lon)) return res.status(400).json({ error: "Invalid coordinates" });

    try {
      const candidates = generateCandidates(lat, lon, radiusKm);
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

          // Never show directional label ("Far Northeast") — use coord-derived fallback instead
          const spotName = (geo.name && geo.name !== "Unknown")
            ? geo.name
            : (geo.region || geo.country || `${candidate.lat.toFixed(1)}°N, ${candidate.lon.toFixed(1)}°E`);
          return {
            name: spotName,
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
