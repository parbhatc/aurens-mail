import { pool } from "../db.js";
import { seedInitialData } from "../seed.js";

await seedInitialData();
await pool.end();

