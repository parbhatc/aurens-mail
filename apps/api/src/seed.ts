import { config } from "./config.js";
import { pool, withTransaction } from "./db.js";
import { hashPassword } from "./security.js";

export async function seedInitialData(): Promise<void> {
  const existing = await pool.query("SELECT id FROM users WHERE email = $1", [config.OWNER_EMAIL]);
  const passwordHash = await hashPassword(config.OWNER_PASSWORD);
  const ownerId = (existing.rows[0]?.id as string | undefined) ?? crypto.randomUUID();
  await withTransaction(async (client) => {
    if ((existing.rowCount ?? 0) === 0) {
      await client.query(
        "INSERT INTO users (id,email,display_name,role,password_hash) VALUES ($1,$2,$3,'owner',$4)",
        [ownerId, config.OWNER_EMAIL, "Owner", passwordHash],
      );
    }
    const addresses = ["pa", "support", "admin", "catchall"];
    for (const local of addresses) {
      const address = `${local}@${config.EMAIL_DOMAIN}`;
      const result = await client.query<{ id: string }>(
        `INSERT INTO mailboxes (id,address,display_name,is_catch_all)
         VALUES ($1,$2,$3,$4) ON CONFLICT (address) DO UPDATE SET updated_at = now() RETURNING id`,
        [crypto.randomUUID(), address, local === "catchall" ? "All other mail" : local[0]?.toUpperCase() + local.slice(1), local === "catchall"],
      );
      const mailboxId = result.rows[0]?.id;
      if (mailboxId) await client.query("INSERT INTO user_mailboxes (user_id,mailbox_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [ownerId, mailboxId]);
    }
  });
}

