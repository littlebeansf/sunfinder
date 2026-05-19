import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { MapContainer, TileLayer, Marker, Popup, useMap, Circle } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { SunnySpot, SavedLocation } from "@shared/schema";
import {
  MapPin, Sun, Cloud, CloudRain, Locate, Search, Bookmark, Trash2, Wind, Droplets,
  Thermometer, Eye, ChevronRight, Star, Moon
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
  if (score >= 60) return { label: "Good", cls: "score-bg-good", emoji: "🌤️" };
  if (score >= 40) return { label: "Fair", cls: "score-bg-fair", emoji: "⛅" };
  if (score >= 20) return { label: "Poor", cls: "score-bg-poor", emoji: "🌦️" };
  return { label: "Bad", cls: "score-bg-bad", emoji: "🌧️" };
}

function getScoreColor(score: number): string {
  if (score >= 80) return "#16a34a";
  if (score >= 60) return "#65a30d";
  if (score >= 40) return "#ca8a04";
  if (score >= 20) return "#ea580c";
  return "#dc2626";
}

function getWeatherEmoji(code: number, isNight: boolean): string {
  if (isNight) return "🌙";
  if (code === 0) return "☀️";
  if (code <= 2) return "🌤️";
  if (code === 3) return "☁️";
  if (code <= 48) return "🌫️";
  if (code <= 55) return "🌧️";
  if (code <= 65) return "🌧️";
  if (code <= 75) return "❄️";
  if (code <= 82) return "🌦️";
  return "⛈️";
}

function createSpotIcon(score: number, index: number) {
  const color = getScoreColor(score);
  const score_label = getSunnyScoreLabel(score);
  return L.divIcon({
    className: "",
    html: `<div style="
      width:38px;height:38px;border-radius:50%;border:2.5px solid white;
      background:${color};display:flex;align-items:center;justify-content:center;
      box-shadow:0 2px 10px rgba(0,0,0,0.3);font-size:18px;cursor:pointer;
      color:white;font-weight:700;font-size:13px;font-family:'Plus Jakarta Sans',sans-serif;
    ">${index}</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    popupAnchor: [0, -22],
  });
}

function createUserIcon() {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:18px;height:18px;border-radius:50%;border:3px solid white;
      background:#3b82f6;box-shadow:0 2px 8px rgba(59,130,246,0.6);
    "></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

// ===== MAP FIT BOUNDS =====
function MapFitBounds({ spots, userLat, userLon }: { spots: SunnySpot[]; userLat: number; userLon: number }) {
  const map = useMap();
  useEffect(() => {
    if (spots.length === 0) return;
    const bounds = L.latLngBounds([[userLat, userLon]]);
    spots.forEach((s) => bounds.extend([s.lat, s.lon]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 });
  }, [spots, userLat, userLon, map]);
  return null;
}

// ===== CURRENT WEATHER CARD =====
function CurrentWeatherCard({ lat, lon }: { lat: number; lon: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/weather/current", lat, lon],
    queryFn: () => apiRequest("GET", `/api/weather/current?lat=${lat}&lon=${lon}`).then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="rounded-2xl border bg-card p-5 space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-10 w-24" />
        <div className="flex gap-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-20" />
        </div>
      </div>
    );
  }
  if (!data) return null;

  const { label, cls, emoji } = getSunnyScoreLabel(data.sunnyScore);

  return (
    <div className="rounded-2xl border bg-card p-5 animate-fade-in" data-testid="current-weather-card">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-sm text-muted-foreground font-medium">Your Location</p>
          <h2 className="font-display font-bold text-lg leading-tight">
            {data.name}{data.region ? `, ${data.region}` : ""}
          </h2>
          <p className="text-xs text-muted-foreground">{data.country}</p>
        </div>
        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${cls}`}>
          {emoji} {label}
        </span>
      </div>

      <div className="flex items-center gap-4 mb-4">
        <span className="text-5xl font-display font-bold">{data.temperature}°</span>
        <div>
          <p className="text-base font-medium">{data.weatherDesc}</p>
          <p className="text-sm text-muted-foreground">Feels like {data.feelsLike}°C</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 pt-3 border-t border-border/50">
        <WeatherStat icon={<Wind className="w-3.5 h-3.5" />} value={`${data.windspeed} km/h`} label="Wind" />
        <WeatherStat icon={<Droplets className="w-3.5 h-3.5" />} value={`${data.humidity}%`} label="Humidity" />
        <WeatherStat icon={<Cloud className="w-3.5 h-3.5" />} value={`${data.cloudCover}%`} label="Clouds" />
        <WeatherStat icon={<CloudRain className="w-3.5 h-3.5" />} value={`${data.precipitation}mm`} label="Rain" />
      </div>

      {/* Sunny score bar */}
      <div className="mt-4">
        <div className="flex justify-between text-xs text-muted-foreground mb-1">
          <span>Sunshine score</span>
          <span className="font-semibold" style={{ color: getScoreColor(data.sunnyScore) }}>{data.sunnyScore}/100</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${data.sunnyScore}%`, background: getScoreColor(data.sunnyScore) }}
          />
        </div>
      </div>
    </div>
  );
}

function WeatherStat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-xs font-semibold">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

// ===== SPOT CARD =====
function SpotCard({
  spot, index, isActive, onClick,
}: {
  spot: SunnySpot; index: number; isActive: boolean; onClick: () => void;
}) {
  const { label, cls, emoji } = getSunnyScoreLabel(spot.weather.sunnyScore);
  const weatherEmoji = getWeatherEmoji(spot.weather.weatherCode, spot.weather.isNight);

  return (
    <div
      className={`spot-card rounded-xl border bg-card p-4 transition-all ${isActive ? "active ring-2 ring-primary" : ""}`}
      onClick={onClick}
      data-testid={`spot-card-${index}`}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
    >
      <div className="flex items-start gap-3">
        <div
          className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white font-display font-bold text-sm"
          style={{ background: getScoreColor(spot.weather.sunnyScore) }}
        >
          {index + 1}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display font-semibold text-sm leading-tight truncate">{spot.name}</h3>
            <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
              {emoji} {label}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {spot.region ? `${spot.region}, ` : ""}{spot.country} · {spot.distanceKm} km away
          </p>
          <p className="text-xs mt-1.5 text-foreground/80 line-clamp-2">{spot.description}</p>

          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Thermometer className="w-3 h-3" />
              {spot.weather.temperature}°C
            </span>
            <span className="flex items-center gap-1">
              <Cloud className="w-3 h-3" />
              {spot.weather.cloudCover}%
            </span>
            <span className="flex items-center gap-1">
              <Wind className="w-3 h-3" />
              {spot.weather.windspeed} km/h
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== POPUP CONTENT =====
function SpotPopup({ spot, index }: { spot: SunnySpot; index: number }) {
  const { label, cls, emoji } = getSunnyScoreLabel(spot.weather.sunnyScore);
  return (
    <div className="p-3 min-w-[200px]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <div className="flex items-center justify-between mb-2">
        <span className="font-bold text-sm">{spot.name}</span>
        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>{emoji} {label}</span>
      </div>
      <p className="text-xs text-gray-500 mb-2">{spot.region}{spot.region && ", "}{spot.country} · {spot.distanceKm} km</p>
      <div className="grid grid-cols-2 gap-1.5 text-xs">
        <span>🌡️ {spot.weather.temperature}°C</span>
        <span>☁️ {spot.weather.cloudCover}% clouds</span>
        <span>💨 {spot.weather.windspeed} km/h</span>
        <span>💧 {spot.weather.humidity}%</span>
      </div>
      <div className="mt-2 pt-2 border-t border-gray-100">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Sunshine</span><span style={{ color: getScoreColor(spot.weather.sunnyScore) }}>{spot.weather.sunnyScore}/100</span>
        </div>
        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${spot.weather.sunnyScore}%`, background: getScoreColor(spot.weather.sunnyScore) }} />
        </div>
      </div>
    </div>
  );
}

// ===== THEME TOGGLE =====
function ThemeToggle() {
  const [isDark, setIsDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  }, [isDark]);
  return (
    <button
      onClick={() => setIsDark((d) => !d)}
      className="p-2 rounded-lg border bg-card hover:bg-muted transition-colors"
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      data-testid="theme-toggle"
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}

// ===== MAIN PAGE =====
export default function Home() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);

  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ name: string; lat: number; lon: number }>>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [activeSpotIndex, setActiveSpotIndex] = useState<number | null>(null);
  const [mapRef, setMapRef] = useState<L.Map | null>(null);
  const markerRefs = useRef<Record<number, L.Marker>>({});

  // Fetch sunny spots
  const { data: spots, isLoading: spotsLoading, refetch: refetchSpots } = useQuery<SunnySpot[]>({
    queryKey: ["/api/weather/sunny-spots", coords?.lat, coords?.lon],
    queryFn: () =>
      apiRequest("GET", `/api/weather/sunny-spots?lat=${coords!.lat}&lon=${coords!.lon}`).then((r) => r.json()),
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
      toast({ title: "Location saved!", description: "You can revisit it from your bookmarks." });
    },
  });

  const deleteLocMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/locations/${id}`).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/locations"] }),
  });

  // Geolocation
  const detectLocation = useCallback(() => {
    if (!navigator.geolocation) {
      toast({ title: "Geolocation not supported", variant: "destructive" });
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setIsLocating(false);
        toast({ title: "Location detected!", description: "Searching for sunny spots nearby…" });
      },
      () => {
        setIsLocating(false);
        toast({ title: "Location access denied", description: "Please enter a location manually.", variant: "destructive" });
      },
      { timeout: 10000 }
    );
  }, [toast]);

  // Search
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    try {
      const res = await apiRequest("GET", `/api/geocode?q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      setSearchResults(data);
      setShowDropdown(true);
    } catch {
      toast({ title: "Search failed", variant: "destructive" });
    }
  }, [searchQuery, toast]);

  const selectSearchResult = (item: { name: string; lat: number; lon: number }) => {
    setCoords({ lat: item.lat, lon: item.lon });
    setSearchQuery(item.name.split(",")[0]);
    setShowDropdown(false);
    setSearchResults([]);
  };

  // Open popup when clicking spot card
  const handleSpotCardClick = (index: number, spot: SunnySpot) => {
    setActiveSpotIndex(index);
    const marker = markerRefs.current[index];
    if (marker && mapRef) {
      mapRef.setView([spot.lat, spot.lon], Math.max(mapRef.getZoom(), 9));
      marker.openPopup();
    }
  };

  // Save current location
  const saveCurrentLocation = () => {
    if (!coords) return;
    const name = searchQuery || `Location (${coords.lat.toFixed(2)}, ${coords.lon.toFixed(2)})`;
    saveLocMutation.mutate({
      name,
      lat: coords.lat,
      lon: coords.lon,
      createdAt: new Date().toISOString(),
    });
  };

  return (
    <div className="min-h-screen flex flex-col" data-testid="home-page">
      {/* ===== HEADER ===== */}
      <header className="sticky top-0 z-50 border-b bg-card/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            {/* SVG Logo */}
            <svg aria-label="SunFinder logo" viewBox="0 0 40 40" className="w-9 h-9 animate-spin-slow" fill="none">
              <circle cx="20" cy="20" r="8" fill="#f59e0b" />
              <g stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round">
                <line x1="20" y1="4" x2="20" y2="9" />
                <line x1="20" y1="31" x2="20" y2="36" />
                <line x1="4" y1="20" x2="9" y2="20" />
                <line x1="31" y1="20" x2="36" y2="20" />
                <line x1="7.6" y1="7.6" x2="11.2" y2="11.2" />
                <line x1="28.8" y1="28.8" x2="32.4" y2="32.4" />
                <line x1="7.6" y1="32.4" x2="11.2" y2="28.8" />
                <line x1="28.8" y1="11.2" x2="32.4" y2="7.6" />
              </g>
            </svg>
            <div>
              <h1 className="font-display font-bold text-lg leading-none">SunFinder</h1>
              <p className="text-xs text-muted-foreground leading-none mt-0.5">Escape the clouds</p>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        {/* ===== SEARCH BAR ===== */}
        <div className="mb-6">
          <div className="relative max-w-xl mx-auto">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  ref={searchRef}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder="Enter a city or place…"
                  className="pl-10 h-11 rounded-xl"
                  data-testid="input-search"
                />
                {showDropdown && searchResults.length > 0 && (
                  <div className="search-dropdown bg-card border mt-1 rounded-xl overflow-hidden z-50">
                    {searchResults.map((r, i) => (
                      <button
                        key={i}
                        className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2"
                        onClick={() => selectSearchResult(r)}
                        data-testid={`search-result-${i}`}
                      >
                        <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="truncate">{r.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button onClick={handleSearch} className="h-11 px-5 rounded-xl font-semibold" data-testid="button-search">
                Search
              </Button>
              <Button
                variant="outline"
                onClick={detectLocation}
                disabled={isLocating}
                className="h-11 px-4 rounded-xl"
                title="Detect my location"
                data-testid="button-locate"
              >
                {isLocating ? (
                  <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Locate className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>
        </div>

        {!coords && (
          <div className="text-center py-20 animate-fade-in">
            <div className="text-7xl mb-5 animate-sun-pulse">☀️</div>
            <h2 className="font-display font-bold text-xl mb-2">Where are you right now?</h2>
            <p className="text-muted-foreground text-sm max-w-sm mx-auto mb-6">
              Enter your location or let the app detect it. We'll find the nearest sunny spots within ~400 km.
            </p>
            <Button onClick={detectLocation} disabled={isLocating} className="rounded-xl px-6 h-11 font-semibold" data-testid="button-detect-location">
              <Locate className="w-4 h-4 mr-2" />
              {isLocating ? "Detecting…" : "Detect My Location"}
            </Button>
          </div>
        )}

        {coords && (
          <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
            {/* ===== LEFT PANEL ===== */}
            <aside className="space-y-4 lg:overflow-y-auto lg:max-h-[calc(100vh-160px)] lg:pr-1">
              {/* Current weather */}
              <CurrentWeatherCard lat={coords.lat} lon={coords.lon} />

              {/* Save location button */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 rounded-xl text-xs"
                  onClick={saveCurrentLocation}
                  disabled={saveLocMutation.isPending}
                  data-testid="button-save-location"
                >
                  <Bookmark className="w-3.5 h-3.5 mr-1.5" />
                  Save this location
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl text-xs"
                  onClick={() => refetchSpots()}
                  data-testid="button-refresh"
                >
                  Refresh
                </Button>
              </div>

              {/* Saved locations */}
              {savedLocs.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <Star className="w-3.5 h-3.5" /> Saved Locations
                  </h3>
                  <div className="space-y-1.5">
                    {savedLocs.map((loc) => (
                      <div key={loc.id} className="flex items-center gap-2 p-2.5 rounded-xl border bg-card hover:bg-muted transition-colors group">
                        <button
                          className="flex-1 text-left text-sm font-medium truncate"
                          onClick={() => setCoords({ lat: loc.lat, lon: loc.lon })}
                          data-testid={`saved-location-${loc.id}`}
                        >
                          {loc.name}
                        </button>
                        <button
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
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

              {/* Spots list */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <Sun className="w-3.5 h-3.5" />
                  Nearby Sunny Spots
                  {spots && <Badge variant="secondary" className="ml-auto text-xs">{spots.length}</Badge>}
                </h3>

                {spotsLoading && (
                  <div className="space-y-3">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="rounded-xl border bg-card p-4 space-y-2">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                        <Skeleton className="h-3 w-full" />
                      </div>
                    ))}
                  </div>
                )}

                {spots && spots.length > 0 && (
                  <div className="space-y-2.5 animate-slide-up">
                    {spots.map((spot, i) => (
                      <SpotCard
                        key={`${spot.lat}-${spot.lon}`}
                        spot={spot}
                        index={i}
                        isActive={activeSpotIndex === i}
                        onClick={() => handleSpotCardClick(i, spot)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </aside>

            {/* ===== MAP ===== */}
            <div className="h-[500px] lg:h-[calc(100vh-160px)] rounded-2xl overflow-hidden border shadow-sm">
              <MapContainer
                center={[coords.lat, coords.lon]}
                zoom={8}
                className="w-full h-full"
                ref={(map) => setMapRef(map)}
                zoomControl={true}
              >
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                />

                {/* User marker */}
                <Marker position={[coords.lat, coords.lon]} icon={createUserIcon()}>
                  <Popup>
                    <div className="p-2 text-sm font-semibold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                      📍 Your location
                    </div>
                  </Popup>
                </Marker>

                {/* Radius circle */}
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
                      <SpotPopup spot={spot} index={i} />
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

      <footer className="border-t py-4 text-center text-xs text-muted-foreground">
        Weather data via <a href="https://open-meteo.com" target="_blank" rel="noopener" className="underline hover:text-foreground">Open-Meteo</a> &amp; <a href="https://nominatim.openstreetmap.org" target="_blank" rel="noopener" className="underline hover:text-foreground">Nominatim</a> · Built by littlebeansf
      </footer>
    </div>
  );
}
