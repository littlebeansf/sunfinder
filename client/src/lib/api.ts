// All API calls that can run client-side (for GitHub Pages static deployment)
// When running with backend, these are proxied through /api/*
// When running statically, they call external APIs directly

const IS_STATIC = import.meta.env.VITE_STATIC_MODE === 'true';

const WMO_CODES: Record<number, string> = {
  0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Foggy", 48: "Depositing rime fog",
  51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
  61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
  71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Slight rain showers", 81: "Moderate rain showers", 82: "Violent rain showers",
  85: "Slight snow showers", 86: "Heavy snow showers",
  95: "Thunderstorm", 96: "Thunderstorm with slight hail", 99: "Thunderstorm with heavy hail",
};

export function getWmoDesc(code: number): string {
  return WMO_CODES[code] || "Unknown";
}

export function calcSunnyScore(weatherCode: number, cloudCover: number, precipitation: number): number {
  let score = 100;
  if (weatherCode === 0) score -= 0;
  else if (weatherCode <= 2) score -= 10;
  else if (weatherCode === 3) score -= 35;
  else if (weatherCode <= 48) score -= 50;
  else if (weatherCode <= 55) score -= 60;
  else if (weatherCode <= 65) score -= 75;
  else if (weatherCode <= 82) score -= 80;
  else score -= 90;
  score -= (cloudCover / 100) * 30;
  score -= Math.min(precipitation * 20, 20);
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function geocodeSearch(q: string) {
  if (!IS_STATIC) {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
    return res.json();
  }
  // Photon (Komoot) has full CORS support — safe for browser calls
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&lang=en`;
  const res = await fetch(url);
  const data = await res.json() as any;
  return (data.features || []).map((f: any) => ({
    name: [
      f.properties.name,
      f.properties.city || f.properties.county,
      f.properties.state,
      f.properties.country,
    ].filter(Boolean).join(", "),
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
  }));
}

export async function reverseGeocode(lat: number, lon: number) {
  if (IS_STATIC) {
    // Photon reverse geocode — full CORS, no User-Agent required
    try {
      const url = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&limit=1&lang=en`;
      const res = await fetch(url);
      const data = await res.json() as any;
      const p = data.features?.[0]?.properties || {};
      // Pick most specific name — include district/county as final fallback before coords
      const name = p.name || p.city || p.town || p.village ||
                   p.municipality || p.suburb || p.hamlet ||
                   p.district || p.county || p.state || null;
      return {
        name: name || `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`,
        region: p.state || p.county || "",
        country: (p.countrycode || "").toUpperCase(),
      };
    } catch {
      return { name: "Unknown", region: "", country: "" };
    }
  }
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10`;
  const res = await fetch(url, { headers: { "User-Agent": "SunFinder/1.0" } });
  const data = await res.json() as any;
  const address = data.address || {};
  return {
    name: address.city || address.town || address.village || address.municipality || address.county || "Unknown",
    region: address.state || address.county || "",
    country: (address.country_code || "").toUpperCase(),
  };
}

// radiusKm: search radius in km (default 200). Offsets are scaled to fit ~4 rings.
export function generateCandidates(lat: number, lon: number, radiusKm = 200) {
  // Convert km to approximate degrees (1° lat ≈ 111 km)
  const latPerKm = 1 / 111;
  const lonPerKm = 1 / (111 * Math.cos((lat * Math.PI) / 180));
  const near = radiusKm * 0.4;   // ~40% of radius
  const mid  = radiusKm * 0.7;   // ~70% of radius
  const far  = radiusKm * 1.0;   // full radius
  const rings = [
    // Near ring (4 cardinal)
    { dlat:  near * latPerKm, dlon: 0 },
    { dlat: -near * latPerKm, dlon: 0 },
    { dlat: 0, dlon:  near * lonPerKm },
    { dlat: 0, dlon: -near * lonPerKm },
    // Mid ring (4 diagonal)
    { dlat:  mid * latPerKm, dlon:  mid * lonPerKm },
    { dlat:  mid * latPerKm, dlon: -mid * lonPerKm },
    { dlat: -mid * latPerKm, dlon:  mid * lonPerKm },
    { dlat: -mid * latPerKm, dlon: -mid * lonPerKm },
    // Far ring (4 cardinal + 4 diagonal)
    { dlat:  far * latPerKm, dlon: 0 },
    { dlat: -far * latPerKm, dlon: 0 },
    { dlat: 0, dlon:  far * lonPerKm },
    { dlat: 0, dlon: -far * lonPerKm },
    { dlat:  far * 0.7 * latPerKm, dlon:  far * 0.7 * lonPerKm },
    { dlat: -far * 0.7 * latPerKm, dlon:  far * 0.7 * lonPerKm },
    { dlat: -far * 0.7 * latPerKm, dlon: -far * 0.7 * lonPerKm },
    { dlat:  far * 0.7 * latPerKm, dlon: -far * 0.7 * lonPerKm },
  ];
  return rings.map((o) => ({
    lat: Math.max(-89, Math.min(89, lat + o.dlat)),
    lon: ((lon + o.dlon + 180) % 360) - 180,
  }));
}

function generateDesc(temp: number, cloudCover: number, score: number, weatherCode: number): string {
  if (score >= 80) return `Beautiful sunshine with ${temp}°C — perfect for a day trip outdoors.`;
  if (score >= 60) return `Mostly clear skies at ${temp}°C with just ${cloudCover}% cloud cover.`;
  if (score >= 40) return `Partly cloudy at ${temp}°C — decent weather with some sun breaks.`;
  if (score >= 20) return `${getWmoDesc(weatherCode)} at ${temp}°C — not ideal, but worth checking.`;
  return `${getWmoDesc(weatherCode)} at ${temp}°C — probably not worth the trip.`;
}

export async function fetchCurrentWeather(lat: number, lon: number, _radiusKm?: number) {
  if (!IS_STATIC) {
    const res = await fetch(`/api/weather/current?lat=${lat}&lon=${lon}`);
    return res.json();
  }
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_speed_10m,is_day&daily=sunrise,sunset&timezone=auto&forecast_days=2`;
  const weatherRes = await fetch(url);
  const weatherJson = await weatherRes.json() as any;
  const c = weatherJson.current;
  // Next sunrise: first one still in the future
  const sunriseArr: string[] = weatherJson.daily?.sunrise || [];
  const now = Date.now();
  const nextSunrise = sunriseArr.map((s: string) => new Date(s).getTime()).find((t: number) => t > now) || null;
  const geo = await reverseGeocode(lat, lon);
  const weatherCode = c.weather_code ?? 0;
  const cloudCover = c.cloud_cover ?? 0;
  const precipitation = c.precipitation ?? 0;
  return {
    lat, lon, ...geo,
    temperature: Math.round(c.temperature_2m),
    feelsLike: Math.round(c.apparent_temperature),
    weatherCode, weatherDesc: getWmoDesc(weatherCode),
    cloudCover, windspeed: Math.round(c.wind_speed_10m),
    humidity: c.relative_humidity_2m, precipitation,
    sunnyScore: calcSunnyScore(weatherCode, cloudCover, precipitation),
    isNight: c.is_day === 0,
    nextSunrise,
  };
}

export async function fetchSunnySpots(lat: number, lon: number, radiusKm = 200) {
  if (!IS_STATIC) {
    const res = await fetch(`/api/weather/sunny-spots?lat=${lat}&lon=${lon}&radius=${radiusKm}`);
    return res.json();
  }
  const candidates = generateCandidates(lat, lon, radiusKm);
  const lats = candidates.map(p => p.lat.toFixed(4)).join(",");
  const lons = candidates.map(p => p.lon.toFixed(4)).join(",");
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_speed_10m,is_day&timezone=auto&forecast_days=1`;
  const weatherRes = await fetch(url);
  const arr = await weatherRes.json() as any[];
  const geoResults = await Promise.all(candidates.map(c => reverseGeocode(c.lat, c.lon)));

  return candidates.map((candidate, i) => {
    const w = arr[i];
    if (!w?.current) return null;
    const c = w.current;
    const weatherCode = c.weather_code ?? 0;
    const cloudCover = c.cloud_cover ?? 0;
    const precipitation = c.precipitation ?? 0;
    const temperature = Math.round(c.temperature_2m);
    const sunnyScore = calcSunnyScore(weatherCode, cloudCover, precipitation);
    const geo = geoResults[i];
    return {
      name: (geo.name && geo.name !== "Unknown") ? geo.name : (geo.region || geo.country || `${candidate.lat.toFixed(1)}°N, ${candidate.lon.toFixed(1)}°E`),
      region: geo.region, country: geo.country,
      lat: candidate.lat, lon: candidate.lon,
      distanceKm: Math.round(haversineKm(lat, lon, candidate.lat, candidate.lon)),
      weather: {
        lat: candidate.lat, lon: candidate.lon,
        name: geo.name, country: geo.country,
        temperature, feelsLike: Math.round(c.apparent_temperature),
        weatherCode, weatherDesc: getWmoDesc(weatherCode),
        cloudCover, windspeed: Math.round(c.wind_speed_10m),
        humidity: c.relative_humidity_2m, precipitation, sunnyScore,
        isNight: c.is_day === 0,
      },
      description: generateDesc(temperature, cloudCover, sunnyScore, weatherCode),
    };
  }).filter(Boolean).sort((a: any, b: any) => b.weather.sunnyScore - a.weather.sunnyScore).slice(0, 8);
}
