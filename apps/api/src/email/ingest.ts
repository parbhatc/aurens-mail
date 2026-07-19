import type { PoolClient } from "pg";
import { config } from "../config.js";
import { pool, withTransaction } from "../db.js";
import { deleteObjects, putObject } from "../storage.js";
import { normalizeAddress } from "../security.js";
import { parseEmail, type ParsedEmail } from "./parser.js";

interface MailboxRow { id: string; address: string; is_catch_all: boolean }

export async function resolveMailbox(recipient: string): Promise<MailboxRow | null> {
  const normalized = normalizeAddress(recipient);
  const result = await pool.query<MailboxRow>(
    `SELECT id, address, is_catch_all
       FROM mailboxes
      WHERE is_active = true AND (address = $1 OR is_catch_all = true)
      ORDER BY (address = $1) DESC
      LIMIT 1`,
    [normalized],
  );
  return result.rows[0] ?? null;
}

function objectPrefix(messageId: string, date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `emails/${year}/${month}/${messageId}`;
}

async function senderIsBlocked(sender: string): Promise<boolean> {
  const domain = sender.split("@")[1] ?? "";
  const result = await pool.query(
    `SELECT rule_type FROM sender_rules
      WHERE (match_type = 'address' AND value = $1)
         OR (match_type = 'domain' AND value = $2)
      ORDER BY CASE rule_type WHEN 'allow' THEN 0 ELSE 1 END LIMIT 1`,
    [sender, domain],
  );
  return result.rows[0]?.rule_type === "block";
}

async function insertMessage(
  client: PoolClient,
  mailbox: MailboxRow,
  envelopeRecipient: string,
  raw: Buffer,
  parsed: ParsedEmail,
  storedKeys: string[],
): Promise<{ id: string; duplicate: boolean }> {
  const messageId = crypto.randomUUID();
  const prefix = objectPrefix(messageId, parsed.receivedAt);
  const rawKey = `${prefix}/raw.eml`;
  const textKey = parsed.text ? `${prefix}/body.txt` : null;
  const htmlKey = parsed.html ? `${prefix}/body.html` : null;
  const acceptableAttachments = parsed.attachments
    .slice(0, config.MAX_ATTACHMENTS)
    .filter((item) => item.content.length <= config.MAX_ATTACHMENT_SIZE);
  const warningParts: string[] = [];
  if (parsed.attachments.length > config.MAX_ATTACHMENTS) warningParts.push("Some attachments were omitted because the message exceeded the attachment-count limit.");
  if (parsed.attachments.some((item) => item.content.length > config.MAX_ATTACHMENT_SIZE)) warningParts.push("One or more oversized attachments were omitted.");
  if (acceptableAttachments.some((item) => item.suspicious)) warningParts.push("This message contains a potentially unsafe attachment.");

  const duplicate = parsed.internetMessageId
    ? await client.query("SELECT id FROM messages WHERE mailbox_id = $1 AND internet_message_id = $2", [mailbox.id, parsed.internetMessageId])
    : { rowCount: 0, rows: [] };
  if ((duplicate.rowCount ?? 0) > 0) return { id: duplicate.rows[0].id as string, duplicate: true };

  await putObject(rawKey, raw, "message/rfc822");
  storedKeys.push(rawKey);
  if (textKey) { await putObject(textKey, parsed.text, "text/plain; charset=utf-8"); storedKeys.push(textKey); }
  if (htmlKey) { await putObject(htmlKey, parsed.html ?? "", "text/html; charset=utf-8"); storedKeys.push(htmlKey); }

  await client.query(
    `INSERT INTO messages (
       id, mailbox_id, internet_message_id, sender_name, sender_address, sender_domain,
       recipient_address, recipients, cc, reply_to, subject, preview, text_object_key,
       html_object_key, raw_object_key, received_at, size_bytes, has_attachments, folder, warning
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [
      messageId, mailbox.id, parsed.internetMessageId, parsed.senderName, parsed.senderAddress,
      parsed.senderAddress.split("@")[1] ?? null, normalizeAddress(envelopeRecipient),
      JSON.stringify(parsed.recipients), JSON.stringify(parsed.cc), parsed.replyTo, parsed.subject,
      parsed.preview, textKey, htmlKey, rawKey, parsed.receivedAt, raw.length,
      acceptableAttachments.length > 0, (await senderIsBlocked(parsed.senderAddress)) ? "spam" : "inbox",
      warningParts.join(" ") || null,
    ],
  );

  for (const item of acceptableAttachments) {
    const key = `${prefix}/attachments/${item.id}/${item.filename}`;
    await putObject(key, item.content, item.contentType);
    storedKeys.push(key);
    await client.query(
      `INSERT INTO attachments (id, message_id, filename, content_type, content_id, disposition, size_bytes, object_key, is_suspicious)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [item.id, messageId, item.filename, item.contentType, item.contentId, item.disposition, item.content.length, key, item.suspicious],
    );
  }
  return { id: messageId, duplicate: false };
}

export async function ingestRawEmail(raw: Buffer, envelopeSender: string, recipients: readonly string[]): Promise<void> {
  if (raw.length > config.MAX_EMAIL_SIZE) throw new Error("MESSAGE_TOO_LARGE");
  const parsed = await parseEmail(raw, envelopeSender);
  for (const recipient of new Set(recipients.map(normalizeAddress))) {
    const mailbox = await resolveMailbox(recipient);
    if (!mailbox) continue;
    const storedKeys: string[] = [];
    try {
      await withTransaction((client) => insertMessage(client, mailbox, recipient, raw, parsed, storedKeys));
    } catch (error) {
      await deleteObjects(storedKeys);
      await pool.query(
        `INSERT INTO processing_failures (id, envelope_sender, envelope_recipient, error_code, detail)
         VALUES ($1,$2,$3,$4,$5)`,
        [crypto.randomUUID(), envelopeSender, recipient, "INGEST_FAILED", error instanceof Error ? error.message.slice(0, 500) : "Unknown error"],
      ).catch(() => undefined);
      throw error;
    }
  }
}

