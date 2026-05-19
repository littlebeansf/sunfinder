import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "@shared/schema";
import { savedLocations, InsertSavedLocation, SavedLocation } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

const sqlite = new Database("data.db");
const db = drizzle(sqlite, { schema });

// Create table if not exists
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS saved_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    created_at TEXT NOT NULL
  )
`);

export interface IStorage {
  getSavedLocations(): SavedLocation[];
  saveLocation(location: InsertSavedLocation): SavedLocation;
  deleteLocation(id: number): void;
}

export class SqliteStorage implements IStorage {
  getSavedLocations(): SavedLocation[] {
    return db.select().from(savedLocations).orderBy(desc(savedLocations.createdAt)).all();
  }

  saveLocation(location: InsertSavedLocation): SavedLocation {
    return db.insert(savedLocations).values(location).returning().get();
  }

  deleteLocation(id: number): void {
    db.delete(savedLocations).where(eq(savedLocations.id, id)).run();
  }
}

export const storage = new SqliteStorage();
