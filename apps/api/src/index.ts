import { runOrphanCleanup, runRetentionCleanup } from "./cleanup.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { createSmtpServer } from "./email/smtp.js";
import { createHttpServer } from "./http/server.js";
import { runMigrations } from "./migrations.js";
import { seedInitialData } from "./seed.js";
import { ensureBucket } from "./storage.js";

async function main(): Promise<void> {
  await runMigrations();
  await ensureBucket();
  await seedInitialData();
  const http = await createHttpServer();
  await http.listen({ host: config.HTTP_HOST, port: config.HTTP_PORT });
  const smtp = createSmtpServer(http.log);
  smtp.listen(config.SMTP_PORT, config.SMTP_HOST, () => http.log.info({ port: config.SMTP_PORT }, "Internal SMTP ingestion listening"));

  const cleanupTimer = setInterval(() => void runRetentionCleanup(http.log), 6 * 60 * 60 * 1000);
  const orphanTimer = setInterval(() => void runOrphanCleanup(http.log), 24 * 60 * 60 * 1000);
  cleanupTimer.unref(); orphanTimer.unref();

  const shutdown = async () => {
    clearInterval(cleanupTimer); clearInterval(orphanTimer);
    smtp.close();
    await http.close();
    await pool.end();
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

