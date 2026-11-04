import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import path from "node:path";
import * as schema from "./schema";

const dbPath = process.env.DB_FILE || "sqlite.db";

export const sqlite = new Database(dbPath);
sqlite.run("PRAGMA journal_mode = WAL;");
sqlite.run("PRAGMA foreign_keys = ON;");

export const db = drizzle(sqlite, { schema });

const migrationsFolder = path.resolve(import.meta.dir, "../../drizzle");
migrate(db, { migrationsFolder });

export * from "./schema";
