import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

let database: Database.Database | undefined;

export function db() {
  if (database) return database;
  const path = resolve(/* turbopackIgnore: true */ process.env.DATABASE_PATH || "./data/app.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  database = new Database(path);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, last_product_id INTEGER, city TEXT);
    CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, article TEXT, supplier_article TEXT, name TEXT NOT NULL, search_text TEXT NOT NULL, payload TEXT NOT NULL, fetched_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS catalog_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, version INTEGER NOT NULL, cart_version INTEGER NOT NULL, status TEXT NOT NULL, lines TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, result TEXT, FOREIGN KEY(session_id) REFERENCES sessions(id));
    CREATE TABLE IF NOT EXISTS carts (session_id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 0, FOREIGN KEY(session_id) REFERENCES sessions(id));
    CREATE TABLE IF NOT EXISTS cart_items (session_id TEXT NOT NULL, item_key TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(session_id,item_key), FOREIGN KEY(session_id) REFERENCES sessions(id));
    CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, filename TEXT NOT NULL, rows TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(session_id) REFERENCES sessions(id));
  `);
  return database;
}
