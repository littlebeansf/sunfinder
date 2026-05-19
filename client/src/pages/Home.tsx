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
  Map, Navigation,
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

// ===== STATIC MODE (GitHub Pages) =====
const IS_STATIC = import.meta.env.VITE_STATIC_MODE === "true";

// ===== localStorage helpers for static mode =====
const LS_KEY = "sunfinder_saved_locations";
function lsGetLocations(): SavedLocation[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
  } catch { return []; }
}
function lsSaveLocation(data: { name: string; lat: number; lon: number }): SavedLocation {
  const locs = lsGetLocations();
  const newLoc: SavedLocation = { id: Date.now(), name: data.name, lat: data.lat, lon: data.lon, createdAt: new Date().toISOString() };
  locs.push(newLoc);
  localStorage.setItem(LS_KEY, JSON.stringify(locs));
  return newLoc;
}
function lsDeleteLocation(id: number) {
  const locs = lsGetLocations().filter((l) => l.id !== id);
  localStorage.setItem(LS_KEY, JSON.stringify(locs));
}

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

// ===== ANIMATED GLOBE ICON (search input) =====
function GlobeIcon() {
  return (
    <span className="globe-icon" aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
        <circle className="globe-sphere" cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.2" />
        <ellipse className="globe-meridian" cx="8" cy="8" rx="3.4" ry="7" stroke="currentColor" strokeWidth="1.1" strokeDasharray="2 1.5" />
        <line className="globe-equator" x1="1" y1="8" x2="15" y2="8" stroke="currentColor" strokeWidth="1" strokeDasharray="1.5 1.2" />
        <path d="M2.5 5 Q8 3.5 13.5 5" stroke="currentColor" strokeWidth="0.9" strokeDasharray="1.2 1" />
        <path d="M2.5 11 Q8 12.5 13.5 11" stroke="currentColor" strokeWidth="0.9" strokeDasharray="1.2 1" />
      </svg>
    </span>
  );
}

// ===== 3D CSS GLOBE (landing page) =====
function Globe3D({ onDetect, isLocating }: { onDetect: () => void; isLocating: boolean }) {
  return (
    <div className="globe3d-scene" aria-hidden="true">
      {/* Outer atmospheric glow */}
      <div className="globe3d-atmosphere" />

      {/* The sphere */}
      <div className="globe3d-sphere">
        {/* Grid lines layer — rotates */}
        <div className="globe3d-grid">
          <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="globe3d-svg">
            {/* Latitude lines */}
            {[-60,-40,-20,0,20,40,60].map((lat, i) => {
              const y = 100 + lat * (100 / 90);
              const halfW = Math.sqrt(Math.max(0, 100*100 - (y-100)*(y-100)));
              if (halfW < 2) return null;
              return (
                <ellipse key={`lat-${i}`}
                  cx="100" cy={y}
                  rx={halfW} ry={halfW * 0.18}
                  fill="none"
                  stroke="rgba(250,204,21,0.28)"
                  strokeWidth="0.8"
                />
              );
            })}
            {/* Longitude lines */}
            {[0,30,60,90,120,150].map((_, i) => (
              <ellipse key={`lon-${i}`}
                cx="100" cy="100"
                rx="14" ry="100"
                fill="none"
                stroke="rgba(250,204,21,0.22)"
                strokeWidth="0.8"
                style={{ transformOrigin: "100px 100px", transform: `rotate(${i * 30}deg)` }}
              />
            ))}
            {/* Equator accent */}
            <ellipse cx="100" cy="100" rx="100" ry="18"
              fill="none" stroke="rgba(250,204,21,0.45)" strokeWidth="1.2"
            />
          </svg>
        </div>

        {/* Sun ray highlight — static */}
        <div className="globe3d-highlight" />

        {/* Sunny spot markers on globe */}
        <div className="globe3d-markers">
          {[
            { top: "28%", left: "62%", delay: "0s" },
            { top: "44%", left: "78%", delay: "0.4s" },
            { top: "55%", left: "55%", delay: "0.8s" },
            { top: "35%", left: "40%", delay: "1.2s" },
            { top: "62%", left: "32%", delay: "1.6s" },
          ].map((m, i) => (
            <div
              key={i}
              className="globe3d-marker"
              style={{ top: m.top, left: m.left, animationDelay: m.delay }}
            >
              <div className="globe3d-marker-dot" />
              <div className="globe3d-marker-ring" />
            </div>
          ))}
        </div>

        {/* Terminator shadow (day/night divide) */}
        <div className="globe3d-terminator" />
      </div>

      {/* Shadow below globe */}
      <div className="globe3d-shadow" />

      {/* Orbiting sun */}
      <div className="globe3d-orbit">
        <div className="globe3d-sun-orb">
          <svg viewBox="0 0 32 32" width="32" height="32" fill="none">
            {[0,45,90,135,180,225,270,315].map((a, i) => {
              const r = a * Math.PI / 180;
              return <line key={i}
                x1={16 + 11*Math.cos(r)} y1={16 + 11*Math.sin(r)}
                x2={16 + 15*Math.cos(r)} y2={16 + 15*Math.sin(r)}
                stroke="#fbbf24" strokeWidth="1.8" strokeLinecap="round"
              />;
            })}
            <circle cx="16" cy="16" r="8" fill="#f59e0b" />
            <circle cx="16" cy="16" r="5" fill="#fde68a" />
          </svg>
        </div>
      </div>
    </div>
  );
}

// ===== FULL-BLEED WEATHER BANNER =====
function WeatherBanner({ code, isNight }: { code: number; isNight: boolean }) {
  // Night
  if (isNight) return (
    <div className="wx-bg wx-bg-night">
      <svg viewBox="0 0 400 180" preserveAspectRatio="xMidYMid slice" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Stars scattered */}
        {[
          [40,18],[90,12],[140,30],[200,8],[260,22],[320,14],[370,28],
          [60,50],[160,44],[280,40],[350,55],[110,70],[230,60],[80,90],
          [300,80],[180,95],[380,72],[30,110],[150,100],[320,105],
        ].map(([cx,cy],i) => (
          <circle key={i} className={`wx-star-${(i%5)+1}`} cx={cx} cy={cy} r={i%3===0?2:1.4} fill="#e2e8f0" />
        ))}
        {/* Moon */}
        <g className="wx-moon" style={{ transformOrigin: "310px 62px" }}>
          <path d="M330 30 C300 36 287 72 302 100 C272 85 268 42 290 22 C301 13 320 16 330 30Z"
            fill="#fde68a" />
          <path d="M330 30 C308 40 305 65 316 88 C298 72 300 44 312 28Z"
            fill="#fbbf24" opacity="0.45" />
          {/* Crater details */}
          <circle cx="298" cy="55" r="4" fill="rgba(251,191,36,0.2)" />
          <circle cx="308" cy="75" r="2.5" fill="rgba(251,191,36,0.15)" />
        </g>
        {/* Moon halo */}
        <ellipse className="wx-halo" cx="310" cy="62" rx="52" ry="52" fill="none" stroke="rgba(253,230,138,0.14)" strokeWidth="18" />
        {/* Aurora bands at top */}
        <rect className="wx-aurora-1" x="0" y="0" width="400" height="22" rx="0"
          fill="rgba(16,185,129,0.10)" />
        <rect className="wx-aurora-2" x="0" y="10" width="400" height="14" rx="0"
          fill="rgba(99,102,241,0.08)" />
      </svg>
    </div>
  );

  // Thunderstorm (95-99)
  if (code >= 95) return (
    <div className="wx-bg wx-bg-storm">
      <svg viewBox="0 0 400 180" preserveAspectRatio="xMidYMid slice" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Dark storm clouds */}
        <g className="wx-cloud">
          <ellipse cx="200" cy="55" rx="140" ry="52" fill="#334155" />
          <ellipse cx="120" cy="70" rx="90" ry="44" fill="#1e293b" />
          <ellipse cx="300" cy="68" rx="100" ry="46" fill="#334155" />
          <ellipse cx="60" cy="80" rx="60" ry="32" fill="#0f172a" opacity="0.8" />
          <ellipse cx="360" cy="75" rx="50" ry="30" fill="#1e293b" opacity="0.7" />
        </g>
        {/* Rain drops */}
        {[50,90,130,170,210,250,290,330,370,70,110,150,190,230,270,310,350].map((x,i) => (
          <line key={i} className={`wx-rain-${(i%8)+1}`}
            x1={x} y1={90+Math.random()*20} x2={x-8} y2={140+Math.random()*20}
            stroke="#93c5fd" strokeWidth="1.6" strokeLinecap="round"
          />
        ))}
        {/* Lightning bolts */}
        <path className="wx-lightning"
          d="M200 80 L182 122 L196 122 L178 165"
          stroke="#fbbf24" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        <path className="wx-lightning" style={{ animationDelay: "1.8s" }}
          d="M290 85 L278 115 L288 115 L274 148"
          stroke="#fde68a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );

  // Snow (71-77, 85-86)
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return (
    <div className="wx-bg wx-bg-snow">
      <svg viewBox="0 0 400 180" preserveAspectRatio="xMidYMid slice" fill="none" xmlns="http://www.w3.org/2000/svg">
        <g className="wx-cloud">
          <ellipse cx="200" cy="50" rx="130" ry="42" fill="#e2e8f0" />
          <ellipse cx="110" cy="62" rx="80" ry="36" fill="#f1f5f9" />
          <ellipse cx="300" cy="60" rx="85" ry="36" fill="#e2e8f0" />
        </g>
        {/* Snowflakes — cross pattern */}
        {[60,110,160,210,260,310,360,80,140,190,240,290,340].map((x, i) => {
          const y = 100 + (i%4)*20;
          return (
            <g key={i} className={`wx-snow-${(i%6)+1}`} style={{ transformOrigin: `${x}px ${y}px` }}>
              <line x1={x} y1={y-8} x2={x} y2={y+8} stroke="#bae6fd" strokeWidth="1.6" strokeLinecap="round" />
              <line x1={x-8} y1={y} x2={x+8} y2={y} stroke="#bae6fd" strokeWidth="1.6" strokeLinecap="round" />
              <line x1={x-5} y1={y-5} x2={x+5} y2={y+5} stroke="#e0f2fe" strokeWidth="1.1" strokeLinecap="round" />
              <line x1={x+5} y1={y-5} x2={x-5} y2={y+5} stroke="#e0f2fe" strokeWidth="1.1" strokeLinecap="round" />
            </g>
          );
        })}
      </svg>
    </div>
  );

  // Rain showers (80-82)
  if (code >= 80 && code <= 82) return (
    <div className="wx-bg wx-bg-shower">
      <svg viewBox="0 0 400 180" preserveAspectRatio="xMidYMid slice" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Sun peeking behind */}
        <g className="wx-glow" style={{ transformOrigin: "80px 55px" }}>
          <circle cx="80" cy="55" rx="48" cy2="55" r="48" fill="rgba(253,230,138,0.18)" />
        </g>
        <g className="wx-rays" style={{ transformOrigin: "80px 55px" }}>
          {[0,30,60,90,120,150,180,210,240,270,300,330].map((a, i) => {
            const rad = a * Math.PI / 180;
            return <line key={i}
              x1={80 + 50*Math.cos(rad)} y1={55 + 50*Math.sin(rad)}
              x2={80 + 62*Math.cos(rad)} y2={55 + 62*Math.sin(rad)}
              stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.5"
            />;
          })}
        </g>
        <circle cx="80" cy="55" r="36" fill="#fde68a" opacity="0.75" />
        <circle cx="80" cy="55" r="26" fill="#fbbf24" opacity="0.85" />
        {/* Cloud */}
        <g className="wx-cloud">
          <ellipse cx="240" cy="55" rx="130" ry="44" fill="#94a3b8" />
          <ellipse cx="150" cy="68" rx="85" ry="38" fill="#cbd5e1" />
          <ellipse cx="340" cy="65" rx="75" ry="36" fill="#94a3b8" />
        </g>
        {/* Rain */}
        {[120,160,200,240,280,320,360,140,180,220,260,300,340].map((x,i) => (
          <line key={i} className={`wx-rain-${(i%8)+1}`}
            x1={x} y1={90} x2={x-6} y2={135}
            stroke="#60a5fa" strokeWidth="1.6" strokeLinecap="round"
          />
        ))}
      </svg>
    </div>
  );

  // Heavy rain (61-65)
  if (code >= 61 && code <= 65) return (
    <div className="wx-bg wx-bg-rain">
      <svg viewBox="0 0 400 180" preserveAspectRatio="xMidYMid slice" fill="none" xmlns="http://www.w3.org/2000/svg">
        <g className="wx-cloud">
          <ellipse cx="200" cy="48" rx="145" ry="46" fill="#64748b" />
          <ellipse cx="100" cy="62" rx="90" ry="40" fill="#475569" />
          <ellipse cx="320" cy="60" rx="95" ry="40" fill="#64748b" />
        </g>
        {[45,80,115,150,185,220,255,290,325,360,60,100,140,180,220,260,300,340].map((x,i) => (
          <line key={i} className={`wx-rain-${(i%8)+1}`}
            x1={x} y1={86} x2={x-9} y2={148}
            stroke={i%2===0 ? "#60a5fa" : "#3b82f6"} strokeWidth="1.9" strokeLinecap="round"
          />
        ))}
      </svg>
    </div>
  );

  // Drizzle (51-55)
  if (code >= 51 && code <= 55) return (
    <div className="wx-bg wx-bg-drizzle">
      <svg viewBox="0 0 400 180" preserveAspectRatio="xMidYMid slice" fill="none" xmlns="http://www.w3.org/2000/svg">
        <g className="wx-cloud">
          <ellipse cx="200" cy="48" rx="135" ry="42" fill="#94a3b8" />
          <ellipse cx="105" cy="60" rx="82" ry="36" fill="#cbd5e1" />
          <ellipse cx="305" cy="58" rx="82" ry="36" fill="#94a3b8" />
        </g>
        {[70,110,150,190,230,270,310,350,90,130,170,210,250,290,330].map((x,i) => (
          <line key={i} className={`wx-rain-${(i%8)+1}`}
            x1={x} y1={88} x2={x-4} y2={118}
            stroke="#bae6fd" strokeWidth="1.3" strokeLinecap="round"
          />
        ))}
      </svg>
    </div>
  );

  // Fog (45-48)
  if (code === 45 || code === 48) return (
    <div className="wx-bg wx-bg-fog">
      <svg viewBox="0 0 400 180" preserveAspectRatio="xMidYMid slice" fill="none" xmlns="http://www.w3.org/2000/svg">
        {[30,60,90,120,150].map((y, i) => (
          <rect key={i} className={`wx-fog-${(i%3)+1}`}
            x="0" y={y} width="400" height={i%2===0 ? 16 : 12} rx="8"
            fill={i%2===0 ? "rgba(203,213,225,0.40)" : "rgba(148,163,184,0.35)"}
          />
        ))}
      </svg>
    </div>
  );

  // Overcast (3)
  if (code === 3) return (
    <div className="wx-bg wx-bg-overcast">
      <svg viewBox="0 0 400 180" preserveAspectRatio="xMidYMid slice" fill="none" xmlns="http://www.w3.org/2000/svg">
        <g className="wx-cloud-2">
          <ellipse cx="120" cy="88" rx="100" ry="44" fill="#94a3b8" opacity="0.5" />
        </g>
        <g className="wx-cloud">
          <ellipse cx="220" cy="52" rx="155" ry="52" fill="#94a3b8" opacity="0.85" />
          <ellipse cx="100" cy="65" rx="95" ry="44" fill="#cbd5e1" opacity="0.9" />
          <ellipse cx="340" cy="62" rx="90" ry="42" fill="#94a3b8" opacity="0.8" />
        </g>
        <g className="wx-cloud-2" style={{ animationDelay: "3s" }}>
          <ellipse cx="300" cy="100" rx="120" ry="40" fill="#94a3b8" opacity="0.35" />
        </g>
      </svg>
    </div>
  );

  // Partly cloudy (1-2)
  if (code === 1 || code === 2) return (
    <div className="wx-bg wx-bg-partly">
      <svg viewBox="0 0 400 180" preserveAspectRatio="xMidYMid slice" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Glow */}
        <g className="wx-glow" style={{ transformOrigin: "110px 72px" }}>
          <circle cx="110" cy="72" r="80" fill="rgba(253,230,138,0.15)" />
        </g>
        {/* Rays */}
        <g className="wx-rays" style={{ transformOrigin: "110px 72px" }}>
          {[0,30,60,90,120,150,180,210,240,270,300,330].map((a, i) => {
            const rad = a * Math.PI / 180;
            return <line key={i}
              x1={110 + 64*Math.cos(rad)} y1={72 + 64*Math.sin(rad)}
              x2={110 + 80*Math.cos(rad)} y2={72 + 80*Math.sin(rad)}
              stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" strokeOpacity="0.6"
            />;
          })}
        </g>
        {/* Sun core */}
        <g className="wx-glow" style={{ transformOrigin: "110px 72px" }}>
          <circle cx="110" cy="72" r="48" fill="#fde68a" opacity="0.9" />
          <circle cx="110" cy="72" r="36" fill="#fbbf24" />
          <circle cx="98" cy="60" r="10" fill="#fde68a" opacity="0.5" />
        </g>
        {/* Cloud in front */}
        <g className="wx-cloud">
          <ellipse cx="270" cy="72" rx="118" ry="48" fill="#e2e8f0" />
          <ellipse cx="175" cy="85" rx="78" ry="40" fill="#f1f5f9" />
          <ellipse cx="375" cy="82" rx="65" ry="36" fill="#e2e8f0" />
        </g>
      </svg>
    </div>
  );

  // Clear sky (0) — full sun
  return (
    <div className="wx-bg wx-bg-sun">
      <svg viewBox="0 0 400 180" preserveAspectRatio="xMidYMid slice" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Outer halo */}
        <circle className="wx-halo" cx="200" cy="90" r="90" fill="none" stroke="rgba(253,230,138,0.18)" strokeWidth="30" />
        {/* Glow */}
        <g className="wx-glow" style={{ transformOrigin: "200px 90px" }}>
          <circle cx="200" cy="90" r="75" fill="rgba(253,230,138,0.20)" />
        </g>
        {/* 12 rotating rays */}
        <g className="wx-rays" style={{ transformOrigin: "200px 90px" }}>
          {[0,30,60,90,120,150,180,210,240,270,300,330].map((a, i) => {
            const rad = a * Math.PI / 180;
            return <line key={i}
              x1={200 + 80*Math.cos(rad)} y1={90 + 80*Math.sin(rad)}
              x2={200 + 105*Math.cos(rad)} y2={90 + 105*Math.sin(rad)}
              stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" className="wx-ray-pulse"
            />;
          })}
        </g>
        {/* Sun core */}
        <g className="wx-glow" style={{ transformOrigin: "200px 90px" }}>
          <circle cx="200" cy="90" r="60" fill="#fde68a" />
          <circle cx="200" cy="90" r="44" fill="#fbbf24" />
          <circle cx="182" cy="74" r="14" fill="#fde68a" opacity="0.55" />
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
    <div
      className="rounded-2xl border bg-card animate-pop-in overflow-hidden"
      style={{ position: "relative" }}
      data-testid="current-weather-card"
    >
      {/* Full-bleed animated background */}
      <WeatherBanner code={data.weatherCode} isNight={data.isNight} />

      {/* Card content sits above the background */}
      <div className="wx-content p-5">
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

        {/* Temperature + emoji icon */}
        <div className="flex items-center gap-4 mb-5">
          <span className="text-5xl select-none" role="img" aria-label="weather">{weatherEmoji}</span>
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
        <div className="rounded-xl bg-muted/80 px-3.5 py-2.5 backdrop-blur-sm">
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
    </div>
  );
}

function WeatherStat({ icon, value, unit, label }: { icon: React.ReactNode; value: string; unit: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl bg-muted/80 backdrop-blur-sm py-2.5 px-1">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-xs font-bold tabular-nums leading-none">{value}<span className="font-normal opacity-70">{unit}</span></span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

// ===== MAPS BUTTONS =====
function MapsButtons({ lat, lon, name, size = "sm" }: { lat: number; lon: number; name: string; size?: "sm" | "xs" }) {
  const googleUrl = `https://www.google.com/maps?q=${lat},${lon}`;
  const appleUrl  = `https://maps.apple.com/?ll=${lat},${lon}&q=${encodeURIComponent(name)}`;
  const cls = size === "xs"
    ? "inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold border bg-card hover:bg-muted transition-colors"
    : "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border bg-card hover:bg-muted transition-colors";
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <a href={googleUrl} target="_blank" rel="noopener noreferrer" className={cls} onClick={e => e.stopPropagation()}>
        <Map className={size === "xs" ? "w-2.5 h-2.5" : "w-3 h-3"} />
        Google Maps
      </a>
      <a href={appleUrl} target="_blank" rel="noopener noreferrer" className={cls} onClick={e => e.stopPropagation()}>
        <Navigation className={size === "xs" ? "w-2.5 h-2.5" : "w-3 h-3"} />
        Apple Maps
      </a>
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
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground font-medium mb-2.5">
            <span className="flex items-center gap-1"><Thermometer className="w-3 h-3" />{spot.weather.temperature}°C</span>
            <span className="flex items-center gap-1"><Cloud className="w-3 h-3" />{spot.weather.cloudCover}%</span>
            <span className="flex items-center gap-1"><Wind className="w-3 h-3" />{spot.weather.windspeed} km/h</span>
          </div>

          {/* Maps buttons */}
          <MapsButtons lat={spot.lat} lon={spot.lon} name={spot.name} size="xs" />
        </div>
      </div>
    </div>
  );
}

// ===== POPUP CONTENT =====
function SpotPopup({ spot }: { spot: SunnySpot }) {
  const { label, cls } = getSunnyScoreLabel(spot.weather.sunnyScore);
  const emoji = getWeatherEmoji(spot.weather.weatherCode, spot.weather.isNight);
  const googleUrl = `https://www.google.com/maps?q=${spot.lat},${spot.lon}`;
  const appleUrl  = `https://maps.apple.com/?ll=${spot.lat},${spot.lon}&q=${encodeURIComponent(spot.name)}`;
  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", padding: "14px 16px", minWidth: "220px" }}>
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
      <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: "8px", marginBottom: "10px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#6b7280", marginBottom: "5px" }}>
          <span>Sunshine</span>
          <span style={{ fontWeight: 700, color: getScoreColor(spot.weather.sunnyScore) }}>{spot.weather.sunnyScore}/100</span>
        </div>
        <div style={{ height: "6px", borderRadius: "999px", background: "#f0f0f0", overflow: "hidden" }}>
          <div style={{ height: "100%", borderRadius: "inherit", width: `${spot.weather.sunnyScore}%`, background: getScoreColor(spot.weather.sunnyScore) }} />
        </div>
      </div>
      {/* Maps buttons in popup */}
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
        <a href={googleUrl} target="_blank" rel="noopener noreferrer"
          style={{ display:"inline-flex", alignItems:"center", gap:"4px", padding:"5px 10px", borderRadius:"8px", fontSize:"11px", fontWeight:600, border:"1px solid #e5e7eb", background:"#f9fafb", color:"#374151", textDecoration:"none", whiteSpace:"nowrap" }}>
          🗺️ Google Maps
        </a>
        <a href={appleUrl} target="_blank" rel="noopener noreferrer"
          style={{ display:"inline-flex", alignItems:"center", gap:"4px", padding:"5px 10px", borderRadius:"8px", fontSize:"11px", fontWeight:600, border:"1px solid #e5e7eb", background:"#f9fafb", color:"#374151", textDecoration:"none", whiteSpace:"nowrap" }}>
          🧭 Apple Maps
        </a>
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

  // localStorage state for static mode
  const [lsLocs, setLsLocs] = useState<SavedLocation[]>(() => IS_STATIC ? lsGetLocations() : []);

  // Theme — dark by default
  const [isDark, setIsDark] = useState(true);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  }, [isDark]);
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

  // Fetch sunny spots
  const { data: spots, isLoading: spotsLoading, refetch: refetchSpots } = useQuery<SunnySpot[]>({
    queryKey: ["/api/weather/sunny-spots", coords?.lat, coords?.lon, radiusKm],
    queryFn: () => fetchSunnySpots(coords!.lat, coords!.lon, radiusKm) as Promise<SunnySpot[]>,
    enabled: !!coords,
    staleTime: 5 * 60 * 1000,
  });

  // Saved locations — server mode
  const { data: serverLocs = [] } = useQuery<SavedLocation[]>({
    queryKey: ["/api/locations"],
    queryFn: () => apiRequest("GET", "/api/locations").then((r) => r.json()),
    enabled: !IS_STATIC,
  });

  const savedLocs: SavedLocation[] = IS_STATIC ? lsLocs : serverLocs;

  // Save mutation — server
  const saveLocMutation = useMutation({
    mutationFn: (data: { name: string; lat: number; lon: number }) =>
      apiRequest("POST", "/api/locations", {
        name: data.name,
        lat: data.lat,
        lon: data.lon,
        createdAt: new Date().toISOString(),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: "Location saved!", description: "Find it in your bookmarks." });
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err?.message || "Could not save location.", variant: "destructive" });
    },
  });

  const deleteLocMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/locations/${id}`).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/locations"] }),
  });

  const saveCurrentLocation = () => {
    if (!coords) return;
    const name = searchQuery.trim() || `${coords.lat.toFixed(2)}, ${coords.lon.toFixed(2)}`;
    if (IS_STATIC) {
      // localStorage fallback
      lsSaveLocation({ name, lat: coords.lat, lon: coords.lon });
      setLsLocs(lsGetLocations());
      toast({ title: "Location saved!", description: "Find it in your bookmarks." });
    } else {
      saveLocMutation.mutate({ name, lat: coords.lat, lon: coords.lon });
    }
  };

  const deleteLocation = (id: number) => {
    if (IS_STATIC) {
      lsDeleteLocation(id);
      setLsLocs(lsGetLocations());
    } else {
      deleteLocMutation.mutate(id);
    }
  };

  // ===== GEOLOCATION =====
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
        if (err.code === err.PERMISSION_DENIED)      msg = "Location access was denied. Please allow it in your browser settings and try again.";
        else if (err.code === err.POSITION_UNAVAILABLE) msg = "Location unavailable. Please enter a city manually.";
        else if (err.code === err.TIMEOUT)           msg = "Location request timed out. Please try again.";
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

  const handleSpotCardClick = (index: number, spot: SunnySpot) => {
    setActiveSpotIndex(index);
    const marker = markerRefs.current[index];
    if (marker && mapRef) {
      mapRef.setView([spot.lat, spot.lon], Math.max(mapRef.getZoom(), 9), { animate: true });
      setTimeout(() => marker.openPopup(), 300);
    }
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

          {/* ===== EMPTY STATE — 3D Globe ===== */}
          {!coords && (
            <div className="flex flex-col items-center justify-center py-8 animate-fade-in">
              <Globe3D onDetect={detectLocation} isLocating={isLocating} />

              <h2 className="font-display font-black text-2xl mb-2 mt-2 text-center">Where are you right now?</h2>
              <p className="text-muted-foreground text-sm max-w-sm mx-auto mb-7 leading-relaxed text-center">
                Enter your location or let the browser detect it.<br />
                We'll find the nearest sunny spots around you.
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

              {/* Saved locations on landing — always visible */}
              {savedLocs.length > 0 && (
                <div className="mt-8 w-full max-w-sm">
                  <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-1.5 justify-center">
                    <Star className="w-3 h-3" /> Saved Locations
                  </p>
                  <div className="space-y-2">
                    {savedLocs.map((loc) => (
                      <div key={loc.id} className="flex items-center gap-2 px-3 py-2.5 rounded-xl border bg-card hover:bg-muted transition-colors group">
                        <button
                          className="flex-1 text-left text-sm font-semibold truncate"
                          onClick={() => { setCoords({ lat: loc.lat, lon: loc.lon }); setSearchQuery(loc.name); setActiveSpotIndex(null); }}
                        >
                          <MapPin className="w-3.5 h-3.5 inline mr-1.5 text-primary" />{loc.name}
                        </button>
                        <button
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-0.5"
                          onClick={() => deleteLocation(loc.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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

                {/* ===== SAVED LOCATIONS — always visible ===== */}
                <div className="animate-slide-left stagger-3">
                  <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-2 flex items-center gap-1.5 px-0.5">
                    <Star className="w-3 h-3" /> Saved
                  </p>
                  {savedLocs.length === 0 ? (
                    <div className="px-3 py-3 rounded-xl border border-dashed border-border text-center">
                      <p className="text-xs text-muted-foreground">No saved locations yet.<br />Hit "Save location" to bookmark a spot.</p>
                    </div>
                  ) : (
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
                            onClick={() => deleteLocation(loc.id)}
                            data-testid={`delete-location-${loc.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

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

                  <Marker position={[coords.lat, coords.lon]} icon={createUserIcon()}>
                    <Popup>
                      <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", padding: "10px 14px", fontWeight: 700, fontSize: "13px" }}>
                        📍 Your location
                      </div>
                    </Popup>
                  </Marker>

                  <Circle
                    center={[coords.lat, coords.lon]}
                    radius={radiusKm * 1000}
                    pathOptions={{ color: "#f59e0b", fillColor: "#f59e0b", fillOpacity: 0.04, weight: 1.5, dashArray: "6 4" }}
                  />

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
