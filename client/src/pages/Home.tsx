import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { geocodeSearch, fetchCurrentWeather, fetchSunnySpots } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { MapContainer, TileLayer, Marker, Popup, useMap, Circle } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { SunnySpot, SavedLocation } from "@shared/schema";
import {
  MapPin, Sun, Cloud, CloudRain, Locate, Search, Bookmark, Trash2,
  Wind, Droplets, Thermometer, Star, Moon, RefreshCw, SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";

// Fix Leaflet default icons
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// ===== HELPERS =====

function getSunnyScoreLabel(score: number) {
  if (score >= 80) return { label: "Excellent", cls: "score-bg-excellent", emoji: "☀️" };
  if (score >= 60) return { label: "Good",      cls: "score-bg-good",      emoji: "🌤️" };
  if (score >= 40) return { label: "Fair",      cls: "score-bg-fair",      emoji: "⛅" };
  if (score >= 20) return { label: "Poor",      cls: "score-bg-poor",      emoji: "🌦️" };
  return             { label: "Bad",       cls: "score-bg-bad",       emoji: "🌧️" };
}

function getScoreColor(score: number): string {
  if (score >= 80) return "#16a34a";
  if (score >= 60) return "#65a30d";
  if (score >= 40) return "#ca8a04";
  if (score >= 20) return "#ea580c";
  return "#dc2626";
}

function getWeatherEmoji(code: number, isNight: boolean): string {
  if (isNight)    return "🌙";
  if (code === 0) return "☀️";
  if (code <= 2)  return "🌤️";
  if (code === 3) return "☁️";
  if (code <= 48) return "🌫️";
  if (code <= 65) return "🌧️";
  if (code <= 75) return "❄️";
  if (code <= 82) return "🌦️";
  return "⛈️";
}

function createSpotIcon(score: number, index: number) {
  const color = getScoreColor(score);
  return L.divIcon({
    className: "",
    html: `<div class="marker-animate" style="
      width:40px;height:40px;border-radius:50%;border:3px solid white;
      background:${color};display:flex;align-items:center;justify-content:center;
      box-shadow:0 3px 12px rgba(0,0,0,0.30);cursor:pointer;
      color:white;font-weight:800;font-size:14px;
      font-family:'Cabinet Grotesk','Plus Jakarta Sans',sans-serif;
      transition:transform 0.15s ease;
    " onmouseover="this.style.transform='scale(1.18)'" onmouseout="this.style.transform='scale(1)'">${index}</div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -24],
  });
}

function createUserIcon() {
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:22px;height:22px">
      <div style="
        position:absolute;inset:0;border-radius:50%;
        background:rgba(59,130,246,0.25);
        animation:locatePulse 2s ease-in-out infinite;
      "></div>
      <div style="
        position:absolute;inset:4px;border-radius:50%;
        background:#3b82f6;border:2px solid white;
        box-shadow:0 2px 8px rgba(59,130,246,0.5);
      "></div>
    </div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

// ===== MAP FIT BOUNDS =====
function MapFitBounds({ spots, userLat, userLon }: { spots: SunnySpot[]; userLat: number; userLon: number }) {
  const map = useMap();
  useEffect(() => {
    if (!spots.length) return;
    const bounds = L.latLngBounds([[userLat, userLon]]);
    spots.forEach((s) => bounds.extend([s.lat, s.lon]));
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 10 });
  }, [spots, userLat, userLon, map]);
  return null;
}

// ===== LOADING SPLASH =====
function SplashScreen({ visible }: { visible: boolean }) {
  const [mounted, setMounted] = useState(true);

  useEffect(() => {
    if (!visible) {
      // keep DOM for fade-out
      const t = setTimeout(() => setMounted(false), 600);
      return () => clearTimeout(t);
    }
  }, [visible]);

  if (!mounted) return null;

  return (
    <div
      className="splash-screen"
      style={{
        animationPlayState: visible ? "paused" : "running",
        animationDuration: "0.55s",
        animationFillMode: "forwards",
        pointerEvents: visible ? "all" : "none",
      }}
    >
      {/* Sun SVG */}
      <div className="splash-sun-wrapper">
        <svg className="splash-rays" viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
          {Array.from({ length: 8 }).map((_, i) => {
            const angle = (i * 45 * Math.PI) / 180;
            const x1 = 48 + 30 * Math.cos(angle);
            const y1 = 48 + 30 * Math.sin(angle);
            const x2 = 48 + 44 * Math.cos(angle);
            const y2 = 48 + 44 * Math.sin(angle);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#f59e0b" strokeWidth="3.5" strokeLinecap="round" />;
          })}
        </svg>
        <svg viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: 54, height: 54 }}>
          <circle cx="48" cy="48" r="20" fill="#f59e0b" />
          <circle cx="48" cy="48" r="16" fill="#fbbf24" />
        </svg>
      </div>
      <div className="splash-title">SunFinder</div>
      <div className="splash-subtitle">Finding your nearest sunshine…</div>
      <div className="splash-dots">
        <div className="splash-dot" />
        <div className="splash-dot" />
        <div className="splash-dot" />
      </div>
    </div>
  );
}

// ===== ANIMATED GLOBE ICON =====
function GlobeIcon() {
  return (
    <span className="globe-icon" aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
        {/* Outer sphere */}
        <circle className="globe-sphere" cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.2" />
        {/* Rotating meridian ellipse */}
        <ellipse className="globe-meridian" cx="8" cy="8" rx="3.4" ry="7" stroke="currentColor" strokeWidth="1.1" strokeDasharray="2 1.5" />
        {/* Static equator line */}
        <line className="globe-equator" x1="1" y1="8" x2="15" y2="8" stroke="currentColor" strokeWidth="1" strokeDasharray="1.5 1.2" />
        {/* Latitude arc top */}
        <path d="M2.5 5 Q8 3.5 13.5 5" stroke="currentColor" strokeWidth="0.9" strokeDasharray="1.2 1" />
        {/* Latitude arc bottom */}
        <path d="M2.5 11 Q8 12.5 13.5 11" stroke="currentColor" strokeWidth="0.9" strokeDasharray="1.2 1" />
      </svg>
    </span>
  );
}

// ===== ANIMATED WEATHER BANNER =====
function WeatherBanner({ code, isNight }: { code: number; isNight: boolean }) {
  // Night
  if (isNight) return (
    <div className="wx-banner">
      <svg viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg" width="120" height="80">
        {/* Stars */}
        <circle className="wx-star-1" cx="20" cy="14" r="2" fill="#e2e8f0" />
        <circle className="wx-star-2" cx="90" cy="10" r="1.5" fill="#e2e8f0" />
        <circle className="wx-star-3" cx="105" cy="28" r="1.8" fill="#cbd5e1" />
        <circle className="wx-star-1" cx="38" cy="8" r="1.2" fill="#e2e8f0" />
        <circle className="wx-star-2" cx="72" cy="18" r="1.5" fill="#cbd5e1" />
        {/* Moon */}
        <g className="wx-moon">
          <path d="M60 16 C48 18 43 30 48 40 C38 35 37 20 46 13 C51 9 57 10 60 16 Z"
            fill="#fde68a" />
          <path d="M60 16 C52 20 50 29 54 37 C48 32 48 20 54 14 Z"
            fill="#fbbf24" opacity="0.5" />
        </g>
        {/* Glow behind moon */}
        <ellipse cx="50" cy="28" rx="14" ry="14" fill="rgba(253,230,138,0.10)" />
      </svg>
    </div>
  );

  // Thunderstorm (95-99)
  if (code >= 95) return (
    <div className="wx-banner">
      <svg viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg" width="120" height="80">
        {/* Dark storm cloud */}
        <g className="wx-cloud">
          <ellipse cx="62" cy="34" rx="30" ry="18" fill="#475569" />
          <ellipse cx="44" cy="38" rx="20" ry="14" fill="#334155" />
          <ellipse cx="80" cy="38" rx="18" ry="13" fill="#475569" />
        </g>
        {/* Rain */}
        <line className="wx-rain-1" x1="42" y1="52" x2="38" y2="66" stroke="#93c5fd" strokeWidth="1.5" strokeLinecap="round" />
        <line className="wx-rain-2" x1="56" y1="52" x2="52" y2="66" stroke="#93c5fd" strokeWidth="1.5" strokeLinecap="round" />
        <line className="wx-rain-3" x1="70" y1="52" x2="66" y2="66" stroke="#93c5fd" strokeWidth="1.5" strokeLinecap="round" />
        <line className="wx-rain-4" x1="84" y1="52" x2="80" y2="66" stroke="#93c5fd" strokeWidth="1.5" strokeLinecap="round" />
        {/* Lightning bolt */}
        <path className="wx-lightning" d="M63 50 L55 64 L62 64 L54 78" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    </div>
  );

  // Snow (71-77, 85-86)
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return (
    <div className="wx-banner">
      <svg viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg" width="120" height="80">
        <g className="wx-cloud">
          <ellipse cx="62" cy="32" rx="28" ry="16" fill="#cbd5e1" />
          <ellipse cx="44" cy="36" rx="18" ry="13" fill="#e2e8f0" />
          <ellipse cx="80" cy="36" rx="16" ry="12" fill="#cbd5e1" />
        </g>
        {/* Snowflakes */}
        <g className="wx-snow-1"><line x1="42" y1="50" x2="42" y2="62" stroke="#bae6fd" strokeWidth="1.5" strokeLinecap="round" /><line x1="36" y1="56" x2="48" y2="56" stroke="#bae6fd" strokeWidth="1.5" strokeLinecap="round" /></g>
        <g className="wx-snow-2"><line x1="60" y1="52" x2="60" y2="64" stroke="#e0f2fe" strokeWidth="1.5" strokeLinecap="round" /><line x1="54" y1="58" x2="66" y2="58" stroke="#e0f2fe" strokeWidth="1.5" strokeLinecap="round" /></g>
        <g className="wx-snow-3"><line x1="78" y1="50" x2="78" y2="62" stroke="#bae6fd" strokeWidth="1.5" strokeLinecap="round" /><line x1="72" y1="56" x2="84" y2="56" stroke="#bae6fd" strokeWidth="1.5" strokeLinecap="round" /></g>
        <g className="wx-snow-4"><line x1="50" y1="62" x2="50" y2="74" stroke="#e0f2fe" strokeWidth="1.5" strokeLinecap="round" /><line x1="44" y1="68" x2="56" y2="68" stroke="#e0f2fe" strokeWidth="1.5" strokeLinecap="round" /></g>
      </svg>
    </div>
  );

  // Rain showers (80-82)
  if (code >= 80 && code <= 82) return (
    <div className="wx-banner">
      <svg viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg" width="120" height="80">
        {/* Sun behind */}
        <circle cx="30" cy="22" r="13" fill="#fde68a" opacity="0.7" />
        <g style={{ transformOrigin: "30px 22px", animation: "sunRaysSpin 14s linear infinite" }}>
          {[0,45,90,135,180,225,270,315].map((a, i) => {
            const r = Math.PI * a / 180;
            return <line key={i} x1={30 + 15*Math.cos(r)} y1={22 + 15*Math.sin(r)} x2={30 + 20*Math.cos(r)} y2={22 + 20*Math.sin(r)} stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" />;
          })}
        </g>
        <circle cx="30" cy="22" r="9" fill="#fbbf24" />
        {/* Cloud */}
        <g className="wx-cloud">
          <ellipse cx="68" cy="32" rx="28" ry="16" fill="#94a3b8" />
          <ellipse cx="50" cy="36" rx="18" ry="13" fill="#cbd5e1" />
          <ellipse cx="86" cy="36" rx="16" ry="12" fill="#94a3b8" />
        </g>
        {/* Rain */}
        <line className="wx-rain-1" x1="50" y1="50" x2="46" y2="64" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" />
        <line className="wx-rain-2" x1="64" y1="50" x2="60" y2="64" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" />
        <line className="wx-rain-3" x1="78" y1="50" x2="74" y2="64" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" />
        <line className="wx-rain-4" x1="57" y1="58" x2="53" y2="72" stroke="#93c5fd" strokeWidth="1.5" strokeLinecap="round" />
        <line className="wx-rain-5" x1="71" y1="58" x2="67" y2="72" stroke="#93c5fd" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  );

  // Heavy rain (61-65)
  if (code >= 61 && code <= 65) return (
    <div className="wx-banner">
      <svg viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg" width="120" height="80">
        <g className="wx-cloud">
          <ellipse cx="60" cy="30" rx="32" ry="18" fill="#64748b" />
          <ellipse cx="40" cy="35" rx="20" ry="15" fill="#475569" />
          <ellipse cx="80" cy="34" rx="20" ry="14" fill="#64748b" />
        </g>
        <line className="wx-rain-1" x1="38" y1="50" x2="33" y2="67" stroke="#60a5fa" strokeWidth="1.8" strokeLinecap="round" />
        <line className="wx-rain-2" x1="52" y1="48" x2="47" y2="65" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" />
        <line className="wx-rain-3" x1="66" y1="50" x2="61" y2="67" stroke="#60a5fa" strokeWidth="1.8" strokeLinecap="round" />
        <line className="wx-rain-4" x1="80" y1="48" x2="75" y2="65" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" />
        <line className="wx-rain-5" x1="44" y1="60" x2="39" y2="77" stroke="#93c5fd" strokeWidth="1.5" strokeLinecap="round" />
        <line className="wx-rain-1" x1="58" y1="58" x2="53" y2="75" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" />
        <line className="wx-rain-2" x1="72" y1="60" x2="67" y2="77" stroke="#93c5fd" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  );

  // Drizzle (51-55)
  if (code >= 51 && code <= 55) return (
    <div className="wx-banner">
      <svg viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg" width="120" height="80">
        <g className="wx-cloud">
          <ellipse cx="60" cy="30" rx="30" ry="17" fill="#94a3b8" />
          <ellipse cx="40" cy="35" rx="19" ry="13" fill="#cbd5e1" />
          <ellipse cx="80" cy="34" rx="18" ry="13" fill="#94a3b8" />
        </g>
        <line className="wx-rain-1" x1="44" y1="50" x2="42" y2="60" stroke="#93c5fd" strokeWidth="1.2" strokeLinecap="round" />
        <line className="wx-rain-3" x1="60" y1="50" x2="58" y2="60" stroke="#bae6fd" strokeWidth="1.2" strokeLinecap="round" />
        <line className="wx-rain-5" x1="76" y1="50" x2="74" y2="60" stroke="#93c5fd" strokeWidth="1.2" strokeLinecap="round" />
        <line className="wx-rain-2" x1="52" y1="58" x2="50" y2="68" stroke="#bae6fd" strokeWidth="1.2" strokeLinecap="round" />
        <line className="wx-rain-4" x1="68" y1="58" x2="66" y2="68" stroke="#93c5fd" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    </div>
  );

  // Fog (45-48)
  if (code === 45 || code === 48) return (
    <div className="wx-banner">
      <svg viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg" width="120" height="80">
        <line className="wx-fog-1" x1="16" y1="24" x2="104" y2="24" stroke="#cbd5e1" strokeWidth="5" strokeLinecap="round" />
        <line className="wx-fog-2" x1="24" y1="36" x2="96" y2="36" stroke="#94a3b8" strokeWidth="4" strokeLinecap="round" />
        <line className="wx-fog-3" x1="16" y1="48" x2="104" y2="48" stroke="#cbd5e1" strokeWidth="5" strokeLinecap="round" />
        <line className="wx-fog-1" x1="28" y1="60" x2="92" y2="60" stroke="#94a3b8" strokeWidth="3.5" strokeLinecap="round" />
        <line className="wx-fog-2" x1="20" y1="70" x2="100" y2="70" stroke="#cbd5e1" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </div>
  );

  // Overcast (code === 3)
  if (code === 3) return (
    <div className="wx-banner">
      <svg viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg" width="120" height="80">
        <g className="wx-cloud-2">
          <ellipse cx="50" cy="42" rx="22" ry="14" fill="#94a3b8" opacity="0.6" />
        </g>
        <g className="wx-cloud">
          <ellipse cx="62" cy="30" rx="34" ry="20" fill="#94a3b8" />
          <ellipse cx="40" cy="36" rx="22" ry="16" fill="#cbd5e1" />
          <ellipse cx="84" cy="36" rx="20" ry="15" fill="#94a3b8" />
        </g>
      </svg>
    </div>
  );

  // Partly cloudy (code 1-2)
  if (code === 1 || code === 2) return (
    <div className="wx-banner">
      <svg viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg" width="120" height="80">
        {/* Sun */}
        <g className="wx-sun-core" style={{ transformOrigin: "38px 36px" }}>
          <circle cx="38" cy="36" r="14" fill="#fde68a" />
        </g>
        <g className="wx-sun-rays" style={{ transformOrigin: "38px 36px" }}>
          {[0,45,90,135,180,225,270,315].map((a, i) => {
            const r = Math.PI * a / 180;
            return <line key={i} x1={38 + 17*Math.cos(r)} y1={36 + 17*Math.sin(r)} x2={38 + 24*Math.cos(r)} y2={36 + 24*Math.sin(r)} stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" />;
          })}
        </g>
        <circle cx="38" cy="36" r="11" fill="#fbbf24" />
        {/* Cloud in front */}
        <g className="wx-cloud">
          <ellipse cx="72" cy="38" rx="28" ry="16" fill="#e2e8f0" />
          <ellipse cx="54" cy="42" rx="18" ry="13" fill="#f1f5f9" />
          <ellipse cx="90" cy="42" rx="17" ry="12" fill="#e2e8f0" />
        </g>
      </svg>
    </div>
  );

  // Clear sky (code === 0) — full sun
  return (
    <div className="wx-banner">
      <svg viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg" width="120" height="80">
        {/* Glow */}
        <circle cx="60" cy="40" r="22" fill="rgba(253,230,138,0.22)" />
        {/* Rotating rays */}
        <g className="wx-sun-rays">
          {[0,30,60,90,120,150,180,210,240,270,300,330].map((a, i) => {
            const r = Math.PI * a / 180;
            return <line key={i} x1={60 + 26*Math.cos(r)} y1={40 + 26*Math.sin(r)} x2={60 + 34*Math.cos(r)} y2={40 + 34*Math.sin(r)} stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" />;
          })}
        </g>
        {/* Core */}
        <g className="wx-sun-core">
          <circle cx="60" cy="40" r="18" fill="#fde68a" />
          <circle cx="60" cy="40" r="13" fill="#fbbf24" />
          <circle cx="56" cy="36" r="4" fill="#fde68a" opacity="0.6" />
        </g>
      </svg>
    </div>
  );
}

// ===== CURRENT WEATHER CARD =====
function CurrentWeatherCard({ lat, lon }: { lat: number; lon: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/weather/current", lat, lon],
    queryFn: () => fetchCurrentWeather(lat, lon),
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="rounded-2xl border bg-card p-5 space-y-3 animate-fade-in">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-12 w-24" />
        <div className="grid grid-cols-4 gap-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10" />)}
        </div>
      </div>
    );
  }
  if (!data) return null;

  const { label, cls } = getSunnyScoreLabel(data.sunnyScore);
  const weatherEmoji = getWeatherEmoji(data.weatherCode, data.isNight);

  return (
    <div className="rounded-2xl border bg-card p-5 animate-pop-in" data-testid="current-weather-card">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Your Location</p>
          <h2 className="font-display font-bold text-lg leading-tight">
            {data.name}{data.region ? `, ${data.region}` : ""}
          </h2>
          <p className="text-xs text-muted-foreground font-medium">{data.country}</p>
        </div>
        <span className={`px-2.5 py-1 rounded-full text-xs font-bold shrink-0 ${cls}`}>
          {label}
        </span>
      </div>

      {/* Temperature + animated weather banner */}
      <div className="flex items-center gap-4 mb-5">
        <WeatherBanner code={data.weatherCode} isNight={data.isNight} />
        <div>
          <div className="flex items-end gap-1">
            <span className="font-display font-black text-5xl leading-none">{data.temperature}°</span>
            <span className="text-sm text-muted-foreground mb-1.5 font-medium">C</span>
          </div>
          <p className="text-sm font-semibold leading-tight">{data.weatherDesc}</p>
          <p className="text-xs text-muted-foreground">Feels like {data.feelsLike}°C</p>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-1.5 mb-4">
        <WeatherStat icon={<Wind className="w-3.5 h-3.5" />}      value={`${data.windspeed}`}  unit="km/h" label="Wind" />
        <WeatherStat icon={<Droplets className="w-3.5 h-3.5" />}  value={`${data.humidity}`}   unit="%" label="Humidity" />
        <WeatherStat icon={<Cloud className="w-3.5 h-3.5" />}     value={`${data.cloudCover}`} unit="%" label="Clouds" />
        <WeatherStat icon={<CloudRain className="w-3.5 h-3.5" />} value={`${data.precipitation}`} unit="mm" label="Rain" />
      </div>

      {/* Score bar */}
      <div className="rounded-xl bg-muted px-3.5 py-2.5">
        <div className="flex justify-between items-center mb-2 text-xs">
          <span className="font-semibold text-muted-foreground">Sunshine score</span>
          <span className="font-bold tabular-nums" style={{ color: getScoreColor(data.sunnyScore) }}>
            {data.sunnyScore}<span className="text-muted-foreground font-normal">/100</span>
          </span>
        </div>
        <div className="h-2 rounded-full bg-border overflow-hidden">
          <div
            className="h-full rounded-full score-bar-fill"
            style={{ width: `${data.sunnyScore}%`, background: getScoreColor(data.sunnyScore) }}
          />
        </div>
      </div>
    </div>
  );
}

function WeatherStat({ icon, value, unit, label }: { icon: React.ReactNode; value: string; unit: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl bg-muted py-2.5 px-1">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-xs font-bold tabular-nums leading-none">{value}<span className="font-normal opacity-70">{unit}</span></span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

// ===== SPOT CARD =====
function SpotCard({
  spot, index, isActive, onClick, animDelay,
}: {
  spot: SunnySpot; index: number; isActive: boolean; onClick: () => void; animDelay: number;
}) {
  const { label, cls } = getSunnyScoreLabel(spot.weather.sunnyScore);
  const weatherEmoji = getWeatherEmoji(spot.weather.weatherCode, spot.weather.isNight);

  return (
    <div
      className={`spot-card rounded-xl border bg-card p-3.5 stagger-init animate-slide-up ${isActive ? "active" : ""}`}
      style={{ animationDelay: `${animDelay}ms`, animationFillMode: "forwards" }}
      onClick={onClick}
      data-testid={`spot-card-${index}`}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
    >
      <div className="flex items-start gap-3">
        {/* Rank badge */}
        <div
          className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-white font-display font-black text-sm shadow-sm"
          style={{ background: getScoreColor(spot.weather.sunnyScore) }}
        >
          {index + 1}
        </div>

        <div className="flex-1 min-w-0">
          {/* Name + score */}
          <div className="flex items-start justify-between gap-2 mb-0.5">
            <h3 className="font-display font-bold text-sm leading-snug truncate flex-1">{spot.name}</h3>
            <span className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-bold ${cls}`}>
              {spot.weather.weatherCode === 0 || spot.weather.sunnyScore >= 80 ? "☀️" : ""} {label}
            </span>
          </div>

          {/* Location + distance */}
          <p className="text-[11px] text-muted-foreground font-medium mb-1.5">
            {spot.region ? `${spot.region}, ` : ""}{spot.country} · {spot.distanceKm} km away
          </p>

          {/* Description */}
          <p className="text-xs text-foreground/75 leading-relaxed line-clamp-2 mb-2">{spot.description}</p>

          {/* Mini stats */}
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground font-medium">
            <span className="flex items-center gap-1"><Thermometer className="w-3 h-3" />{spot.weather.temperature}°C</span>
            <span className="flex items-center gap-1"><Cloud className="w-3 h-3" />{spot.weather.cloudCover}%</span>
            <span className="flex items-center gap-1"><Wind className="w-3 h-3" />{spot.weather.windspeed} km/h</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== POPUP CONTENT =====
function SpotPopup({ spot }: { spot: SunnySpot }) {
  const { label, cls } = getSunnyScoreLabel(spot.weather.sunnyScore);
  const emoji = getWeatherEmoji(spot.weather.weatherCode, spot.weather.isNight);
  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", padding: "14px 16px", minWidth: "210px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
        <span style={{ fontWeight: 700, fontSize: "14px" }}>{spot.name}</span>
        <span className={cls} style={{ padding: "2px 8px", borderRadius: "999px", fontSize: "11px", fontWeight: 700 }}>{label}</span>
      </div>
      <p style={{ fontSize: "11px", color: "#6b7280", marginBottom: "10px" }}>
        {spot.region ? `${spot.region}, ` : ""}{spot.country} · {spot.distanceKm} km
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px", fontSize: "12px", marginBottom: "10px" }}>
        <span>{emoji} {spot.weather.temperature}°C</span>
        <span>☁️ {spot.weather.cloudCover}%</span>
        <span>💨 {spot.weather.windspeed} km/h</span>
        <span>💧 {spot.weather.humidity}%</span>
      </div>
      <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: "8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#6b7280", marginBottom: "5px" }}>
          <span>Sunshine</span>
          <span style={{ fontWeight: 700, color: getScoreColor(spot.weather.sunnyScore) }}>{spot.weather.sunnyScore}/100</span>
        </div>
        <div style={{ height: "6px", borderRadius: "999px", background: "#f0f0f0", overflow: "hidden" }}>
          <div style={{ height: "100%", borderRadius: "inherit", width: `${spot.weather.sunnyScore}%`, background: getScoreColor(spot.weather.sunnyScore) }} />
        </div>
      </div>
    </div>
  );
}

// ===== THEME TOGGLE =====
function ThemeToggle({ isDark, onToggle }: { isDark: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="theme-toggle h-9 w-9 rounded-xl border bg-card flex items-center justify-center transition-colors hover:bg-muted"
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      data-testid="theme-toggle"
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <span style={{ transition: "transform 0.35s cubic-bezier(0.34,1.56,0.64,1), opacity 0.2s", transform: isDark ? "rotate(-20deg)" : "rotate(20deg)" }}>
        {isDark
          ? <Sun className="w-4 h-4 text-amber-400" />
          : <Moon className="w-4 h-4" />
        }
      </span>
    </button>
  );
}

// ===== MAIN PAGE =====
export default function Home() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);

  const [splashVisible, setSplashVisible] = useState(true);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ name: string; lat: number; lon: number }>>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [activeSpotIndex, setActiveSpotIndex] = useState<number | null>(null);
  const [mapRef, setMapRef] = useState<L.Map | null>(null);
  const markerRefs = useRef<Record<number, L.Marker>>({});
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [radiusKm, setRadiusKm] = useState(200);
  const [showRadiusSlider, setShowRadiusSlider] = useState(false);

  // Theme — dark by default
  const [isDark, setIsDark] = useState(true);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  }, [isDark]);
  // Set dark on first mount immediately
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "dark");
  }, []);

  // Hide splash after 1.8s
  useEffect(() => {
    const t = setTimeout(() => setSplashVisible(false), 1800);
    return () => clearTimeout(t);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Fetch sunny spots — re-runs when radius changes
  const { data: spots, isLoading: spotsLoading, refetch: refetchSpots } = useQuery<SunnySpot[]>({
    queryKey: ["/api/weather/sunny-spots", coords?.lat, coords?.lon, radiusKm],
    queryFn: () => fetchSunnySpots(coords!.lat, coords!.lon, radiusKm) as Promise<SunnySpot[]>,
    enabled: !!coords,
    staleTime: 5 * 60 * 1000,
  });

  // Saved locations
  const { data: savedLocs = [] } = useQuery<SavedLocation[]>({
    queryKey: ["/api/locations"],
    queryFn: () => apiRequest("GET", "/api/locations").then((r) => r.json()),
  });

  const saveLocMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/locations", data).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: "Location saved!", description: "Find it in your bookmarks." });
    },
  });

  const deleteLocMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/locations/${id}`).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/locations"] }),
  });

  // ===== GEOLOCATION — fixed =====
  const detectLocation = useCallback(() => {
    if (!navigator.geolocation) {
      toast({ title: "Geolocation not supported", description: "Your browser doesn't support location detection.", variant: "destructive" });
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setIsLocating(false);
        toast({ title: "📍 Location detected", description: "Searching for sunny spots nearby…" });
      },
      (err) => {
        setIsLocating(false);
        let msg = "Please enter a location manually.";
        if (err.code === err.PERMISSION_DENIED) {
          msg = "Location access was denied. Please allow it in your browser settings and try again.";
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          msg = "Location unavailable. Please enter a city manually.";
        } else if (err.code === err.TIMEOUT) {
          msg = "Location request timed out. Please try again.";
        }
        toast({ title: "Location error", description: msg, variant: "destructive" });
      },
      { timeout: 15000, maximumAge: 60000, enableHighAccuracy: false }
    );
  }, [toast]);

  // Search
  const handleSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) return;
    try {
      const data = await geocodeSearch(q);
      if (!data.length) {
        toast({ title: "No results found", description: `Nothing found for "${q}". Try a different name.`, variant: "destructive" });
        return;
      }
      setSearchResults(data);
      setShowDropdown(true);
    } catch {
      toast({ title: "Search failed", description: "Could not connect to geocoding service.", variant: "destructive" });
    }
  }, [searchQuery, toast]);

  const selectSearchResult = (item: { name: string; lat: number; lon: number }) => {
    setCoords({ lat: item.lat, lon: item.lon });
    setSearchQuery(item.name.split(",")[0]);
    setShowDropdown(false);
    setSearchResults([]);
    setActiveSpotIndex(null);
  };

  // Open popup on card click
  const handleSpotCardClick = (index: number, spot: SunnySpot) => {
    setActiveSpotIndex(index);
    const marker = markerRefs.current[index];
    if (marker && mapRef) {
      mapRef.setView([spot.lat, spot.lon], Math.max(mapRef.getZoom(), 9), { animate: true });
      setTimeout(() => marker.openPopup(), 300);
    }
  };

  const saveCurrentLocation = () => {
    if (!coords) return;
    const name = searchQuery || `${coords.lat.toFixed(2)}, ${coords.lon.toFixed(2)}`;
    saveLocMutation.mutate({ name, lat: coords.lat, lon: coords.lon, createdAt: new Date().toISOString() });
  };

  return (
    <>
      <SplashScreen visible={splashVisible} />

      <div className="min-h-screen flex flex-col" data-testid="home-page">
        {/* ===== HEADER ===== */}
        <header className="sticky top-0 z-50 border-b bg-card/90 backdrop-blur-md">
          <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <svg aria-label="SunFinder logo" viewBox="0 0 40 40" className="w-9 h-9 animate-spin-slow" fill="none">
                <circle cx="20" cy="20" r="8" fill="#f59e0b" />
                <g stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="20" y1="4"  x2="20" y2="9"  />
                  <line x1="20" y1="31" x2="20" y2="36" />
                  <line x1="4"  y1="20" x2="9"  y2="20" />
                  <line x1="31" y1="20" x2="36" y2="20" />
                  <line x1="7.6"  y1="7.6"  x2="11.2" y2="11.2" />
                  <line x1="28.8" y1="28.8" x2="32.4" y2="32.4" />
                  <line x1="7.6"  y1="32.4" x2="11.2" y2="28.8" />
                  <line x1="28.8" y1="11.2" x2="32.4" y2="7.6"  />
                </g>
              </svg>
              <div>
                <h1 className="font-display font-black text-lg leading-none tracking-tight">SunFinder</h1>
                <p className="text-[11px] text-muted-foreground leading-none mt-0.5 font-medium">Escape the clouds</p>
              </div>
            </div>
            <ThemeToggle isDark={isDark} onToggle={() => setIsDark((d) => !d)} />
          </div>
        </header>

        <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-5">
          {/* ===== SEARCH BAR ===== */}
          <div className="mb-5">
            <div className="relative max-w-2xl mx-auto" ref={dropdownRef}>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
                    <GlobeIcon />
                  </span>
                  <Input
                    ref={searchRef}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSearch();
                      if (e.key === "Escape") setShowDropdown(false);
                    }}
                    placeholder="Enter a city, region or place…"
                    className="pl-10 h-11 rounded-xl text-sm"
                    data-testid="input-search"
                    autoComplete="off"
                  />
                  {showDropdown && searchResults.length > 0 && (
                    <div className="search-dropdown">
                      {searchResults.map((r, i) => (
                        <button
                          key={i}
                          className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2.5"
                          onClick={() => selectSearchResult(r)}
                          data-testid={`search-result-${i}`}
                        >
                          <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
                          <span className="truncate text-xs">{r.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <Button onClick={handleSearch} className="h-11 px-5 rounded-xl font-bold text-sm" data-testid="button-search">
                  Search
                </Button>
                <Button
                  variant="outline"
                  onClick={detectLocation}
                  disabled={isLocating}
                  className={`h-11 px-3.5 rounded-xl ${isLocating ? "btn-locating" : ""}`}
                  title="Detect my location"
                  data-testid="button-locate"
                >
                  {isLocating
                    ? <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    : <Locate className="w-4 h-4" />
                  }
                </Button>
                {/* Radius toggle */}
                <Button
                  variant="outline"
                  onClick={() => setShowRadiusSlider((v) => !v)}
                  className={`h-11 px-3.5 rounded-xl transition-colors ${showRadiusSlider ? "border-primary text-primary" : ""}`}
                  title="Set search radius"
                  data-testid="button-radius"
                >
                  <SlidersHorizontal className="w-4 h-4" />
                </Button>
              </div>

              {/* Radius slider panel */}
              {showRadiusSlider && (
                <div className="mt-2 px-4 py-3 rounded-xl border bg-card animate-slide-up radius-panel">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                      <SlidersHorizontal className="w-3 h-3" /> Search radius
                    </span>
                    <span className="text-xs font-bold tabular-nums" style={{ color: "hsl(var(--primary))" }}>
                      {radiusKm} km
                    </span>
                  </div>
                  <Slider
                    min={50} max={500} step={25}
                    value={[radiusKm]}
                    onValueChange={([v]) => setRadiusKm(v)}
                    className="w-full"
                    data-testid="slider-radius"
                  />
                  <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
                    <span>50 km</span>
                    <span>500 km</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ===== EMPTY STATE ===== */}
          {!coords && (
            <div className="text-center py-16 animate-fade-in">
              <div className="text-7xl mb-5 animate-sun-pulse inline-block">☀️</div>
              <h2 className="font-display font-black text-xl mb-2">Where are you right now?</h2>
              <p className="text-muted-foreground text-sm max-w-sm mx-auto mb-7 leading-relaxed">
                Enter your location or let the browser detect it automatically.<br/>
                We'll find the nearest sunny spots within ~400 km.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
                <Button
                  onClick={detectLocation}
                  disabled={isLocating}
                  className="rounded-xl px-6 h-11 font-bold animate-pulse-glow"
                  data-testid="button-detect-location"
                >
                  <Locate className="w-4 h-4 mr-2" />
                  {isLocating ? "Detecting…" : "Detect My Location"}
                </Button>
                <span className="text-xs text-muted-foreground">or type a city above</span>
              </div>
              <p className="text-xs text-muted-foreground mt-5 opacity-60">
                💡 Tip: If detection fails, check browser → Site Settings → Location → Allow
              </p>
            </div>
          )}

          {/* ===== MAIN LAYOUT ===== */}
          {coords && (
            <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-5">
              {/* ===== LEFT PANEL ===== */}
              <aside className="space-y-3 lg:overflow-y-auto lg:max-h-[calc(100vh-140px)] lg:pr-0.5">
                <div className="animate-slide-left stagger-1">
                  <CurrentWeatherCard lat={coords.lat} lon={coords.lon} />
                </div>

                {/* Action buttons */}
                <div className="flex gap-2 animate-slide-left stagger-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 rounded-xl text-xs font-semibold h-9"
                    onClick={saveCurrentLocation}
                    disabled={saveLocMutation.isPending}
                    data-testid="button-save-location"
                  >
                    <Bookmark className="w-3.5 h-3.5 mr-1.5" />
                    Save location
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl text-xs font-semibold h-9 px-3"
                    onClick={() => { refetchSpots(); qc.invalidateQueries({ queryKey: ["/api/weather/current"] }); }}
                    data-testid="button-refresh"
                    title="Refresh weather data"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </Button>
                </div>

                {/* Saved locations */}
                {savedLocs.length > 0 && (
                  <div className="animate-slide-left stagger-3">
                    <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-2 flex items-center gap-1.5 px-0.5">
                      <Star className="w-3 h-3" /> Saved
                    </p>
                    <div className="space-y-1.5">
                      {savedLocs.map((loc) => (
                        <div key={loc.id} className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-card hover:bg-muted transition-colors group cursor-pointer">
                          <button
                            className="flex-1 text-left text-sm font-semibold truncate"
                            onClick={() => { setCoords({ lat: loc.lat, lon: loc.lon }); setSearchQuery(loc.name); setActiveSpotIndex(null); }}
                            data-testid={`saved-location-${loc.id}`}
                          >
                            {loc.name}
                          </button>
                          <button
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-0.5"
                            onClick={() => deleteLocMutation.mutate(loc.id)}
                            data-testid={`delete-location-${loc.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Spots section */}
                <div>
                  <div className="flex items-center justify-between mb-2 px-0.5">
                    <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                      <Sun className="w-3 h-3" /> Nearby Sunny Spots
                    </p>
                    {spots && <Badge variant="secondary" className="text-xs font-bold px-2 py-0">{spots.length}</Badge>}
                  </div>

                  {spotsLoading && (
                    <div className="space-y-2.5">
                      {[...Array(5)].map((_, i) => (
                        <div key={i} className="rounded-xl border bg-card p-3.5 space-y-2">
                          <div className="flex gap-3">
                            <Skeleton className="w-9 h-9 rounded-xl shrink-0" />
                            <div className="flex-1 space-y-1.5">
                              <Skeleton className="h-3.5 w-3/4" />
                              <Skeleton className="h-3 w-1/2" />
                              <Skeleton className="h-3 w-full" />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {spots && spots.length > 0 && (
                    <div className="space-y-2">
                      {spots.map((spot, i) => (
                        <SpotCard
                          key={`${spot.lat}-${spot.lon}`}
                          spot={spot}
                          index={i}
                          isActive={activeSpotIndex === i}
                          onClick={() => handleSpotCardClick(i, spot)}
                          animDelay={i * 55}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </aside>

              {/* ===== MAP ===== */}
              <div className="h-[480px] lg:h-[calc(100vh-140px)] rounded-2xl overflow-hidden border shadow-sm animate-fade-in">
                <MapContainer
                  center={[coords.lat, coords.lon]}
                  zoom={8}
                  className="w-full h-full"
                  ref={(map) => setMapRef(map)}
                  zoomControl
                >
                  {/* CartoDB: dark matter in dark mode, Voyager in light mode */}
                  {isDark ? (
                    <TileLayer
                      key="dark"
                      url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                      attribution='&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
                      subdomains="abcd"
                      maxZoom={19}
                    />
                  ) : (
                    <TileLayer
                      key="light"
                      url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                      attribution='&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
                      subdomains="abcd"
                      maxZoom={19}
                    />
                  )}

                  {/* User location marker */}
                  <Marker position={[coords.lat, coords.lon]} icon={createUserIcon()}>
                    <Popup>
                      <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", padding: "10px 14px", fontWeight: 700, fontSize: "13px" }}>
                        📍 Your location
                      </div>
                    </Popup>
                  </Marker>

                  {/* Search radius circle */}
                  <Circle
                    center={[coords.lat, coords.lon]}
                    radius={radiusKm * 1000}
                    pathOptions={{ color: "#f59e0b", fillColor: "#f59e0b", fillOpacity: 0.04, weight: 1.5, dashArray: "6 4" }}
                  />

                  {/* Spot markers */}
                  {spots?.map((spot, i) => (
                    <Marker
                      key={`${spot.lat}-${spot.lon}`}
                      position={[spot.lat, spot.lon]}
                      icon={createSpotIcon(spot.weather.sunnyScore, i + 1)}
                      ref={(ref) => { if (ref) markerRefs.current[i] = ref; }}
                      eventHandlers={{ click: () => setActiveSpotIndex(i) }}
                    >
                      <Popup>
                        <SpotPopup spot={spot} />
                      </Popup>
                    </Marker>
                  ))}

                  {spots && spots.length > 0 && (
                    <MapFitBounds spots={spots} userLat={coords.lat} userLon={coords.lon} />
                  )}
                </MapContainer>
              </div>
            </div>
          )}
        </main>

        <footer className="border-t py-3.5 text-center text-xs text-muted-foreground">
          Weather via <a href="https://open-meteo.com" target="_blank" rel="noopener" className="underline decoration-dotted hover:text-foreground">Open-Meteo</a>
          {" · "}
          Maps via <a href="https://www.openstreetmap.org" target="_blank" rel="noopener" className="underline decoration-dotted hover:text-foreground">OpenStreetMap</a>
          {" · "}
          Built by <a href="https://github.com/littlebeansf" target="_blank" rel="noopener" className="underline decoration-dotted hover:text-foreground">littlebeansf</a>
        </footer>
      </div>
    </>
  );
}
