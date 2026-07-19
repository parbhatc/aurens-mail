import { config } from "./config.js";
import { pool } from "./db.js";
import { deleteObjects, listObjectKeys } from "./storage.js";

export async function runRetentionCleanup(logger: { info: (value: unknown, message?: string) => void; error: (value: unknown, message?: string) => void }): Promise<void> {
  try {
    const expired = await pool.query(
      `SELECT id, raw_object_key, text_object_key, html_object_key
         FROM messages
        WHERE (folder = 'trash' AND deleted_at < now() - ($1::text || ' days')::interval)
           OR (folder = 'spam' AND received_at < now() - ($2::text || ' days')::interval)`,
      [config.TRASH_RETENTION_DAYS, config.SPAM_RETENTION_DAYS],
    );
    let deleted = 0;
    for (const message of expired.rows) {
      const attachments = await pool.query("SELECT object_key FROM attachments WHERE message_id = $1", [message.id]);
      const keys: string[] = [message.raw_object_key, message.text_object_key, message.html_object_key, ...attachments.rows.map((item) => item.object_key)]
        .filter((key): key is string => typeof key === "string");
      await pool.query("DELETE FROM messages WHERE id = $1", [message.id]);
      await deleteObjects(keys);
      deleted += 1;
    }
    await pool.query("DELETE FROM sessions WHERE expires_at <= now()");
    await pool.query("DELETE FROM processing_failures WHERE created_at < now() - interval '90 days'");
    logger.info({ deleted }, "Retention cleanup completed");
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : "Unknown cleanup error" }, "Retention cleanup failed");
  }
}

export async function runOrphanCleanup(logger: { info: (value: unknown, message?: string) => void; error: (value: unknown, message?: string) => void }): Promise<void> {
  try {
    const [objects, messageKeys, attachmentKeys] = await Promise.all([
      listObjectKeys(),
      pool.query("SELECT raw_object_key, text_object_key, html_object_key FROM messages"),
      pool.query("SELECT object_key FROM attachments"),
    ]);
    const referenced = new Set<string>();
    for (const row of messageKeys.rows) for (const key of [row.raw_object_key, row.text_object_key, row.html_object_key]) if (typeof key === "string") referenced.add(key);
    for (const row of attachmentKeys.rows) if (typeof row.object_key === "string") referenced.add(row.object_key);
    const orphans = objects.filter((key) => !referenced.has(key));
    await deleteObjects(orphans);
    logger.info({ deleted: orphans.length }, "Orphan cleanup completed");
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : "Unknown orphan cleanup error" }, "Orphan cleanup failed");
  }
}

