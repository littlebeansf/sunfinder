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
  Wind, Droplets, Thermometer, Star, Moon, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

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

      {/* Temperature */}
      <div className="flex items-center gap-4 mb-5">
        <span className="weather-emoji">{weatherEmoji}</span>
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
function ThemeToggle() {
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = (window as any).__sunfinderTheme;
      if (saved) return saved === "dark";
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return false;
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
    (window as any).__sunfinderTheme = isDark ? "dark" : "light";
  }, [isDark]);

  return (
    <button
      onClick={() => setIsDark((d) => !d)}
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
    queryKey: ["/api/weather/sunny-spots", coords?.lat, coords?.lon],
    queryFn: () => fetchSunnySpots(coords!.lat, coords!.lon) as Promise<SunnySpot[]>,
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
            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-5">
          {/* ===== SEARCH BAR ===== */}
          <div className="mb-5">
            <div className="relative max-w-2xl mx-auto" ref={dropdownRef}>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
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
              </div>
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
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  />

                  {/* User location marker */}
                  <Marker position={[coords.lat, coords.lon]} icon={createUserIcon()}>
                    <Popup>
                      <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", padding: "10px 14px", fontWeight: 700, fontSize: "13px" }}>
                        📍 Your location
                      </div>
                    </Popup>
                  </Marker>

                  {/* Search radius */}
                  <Circle
                    center={[coords.lat, coords.lon]}
                    radius={50000}
                    pathOptions={{ color: "#3b82f6", fillColor: "#3b82f6", fillOpacity: 0.04, weight: 1.5, dashArray: "6 4" }}
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
