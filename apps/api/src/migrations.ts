import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "./db.js";

export async function runMigrations(directory = path.resolve("migrations")): Promise<void> {
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files) {
    const exists = await pool.query("SELECT 1 FROM schema_migrations WHERE name = $1", [name]);
    if ((exists.rowCount ?? 0) > 0) continue;
    const sql = await readFile(path.join(directory, name), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING", [name]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

