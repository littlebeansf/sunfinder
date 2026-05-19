import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Saved locations the user has searched
export const savedLocations = sqliteTable("saved_locations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  createdAt: text("created_at").notNull(),
});

export const insertSavedLocationSchema = createInsertSchema(savedLocations).omit({ id: true });
export type InsertSavedLocation = z.infer<typeof insertSavedLocationSchema>;
export type SavedLocation = typeof savedLocations.$inferSelect;

// Type definitions for weather data (not stored in DB)
export interface WeatherData {
  lat: number;
  lon: number;
  name: string;
  country: string;
  temperature: number;
  feelsLike: number;
  weatherCode: number;
  weatherDesc: string;
  cloudCover: number;
  windspeed: number;
  humidity: number;
  precipitation: number;
  sunnyScore: number; // 0-100
  isNight: boolean;
}

export interface SunnySpot {
  name: string;
  region: string;
  country: string;
  lat: number;
  lon: number;
  distanceKm: number;
  weather: WeatherData;
  description: string;
}
