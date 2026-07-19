import nodemailer from "nodemailer";
import { config } from "../config.js";
import { pool } from "../db.js";
import { deleteObjects, putObject } from "../storage.js";
import { previewText } from "../security.js";

interface OutboundMessage {
  mailboxId: string;
  fromAddress: string;
  fromName: string | null;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  inReplyTo?: string;
}

const smtpTransport = nodemailer.createTransport({
  host: config.OUTBOUND_SMTP_HOST,
  port: config.OUTBOUND_SMTP_PORT,
  secure: config.OUTBOUND_SMTP_SECURE,
  requireTLS: config.OUTBOUND_SMTP_REQUIRE_TLS,
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 30_000,
  ...(config.OUTBOUND_SMTP_USER && config.OUTBOUND_SMTP_PASSWORD
    ? { auth: { user: config.OUTBOUND_SMTP_USER, pass: config.OUTBOUND_SMTP_PASSWORD } }
    : {}),
});

const messageCompiler = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });

function prefix(id: string, date: Date): string {
  return `emails/${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${id}`;
}

export async function sendAndStoreOutbound(input: OutboundMessage): Promise<{ id: string; internetMessageId: string }> {
  if (!config.OUTBOUND_ENABLED) throw new Error("OUTBOUND_DISABLED");
  const id = crypto.randomUUID();
  const internetMessageId = `<${crypto.randomUUID()}@${config.EMAIL_DOMAIN}>`;
  const sentAt = new Date();
  const compiled = await messageCompiler.sendMail({
    from: { name: input.fromName ?? input.fromAddress.split("@")[0] ?? "Aurens", address: input.fromAddress },
    to: input.to,
    cc: input.cc,
    subject: input.subject,
    text: input.text,
    messageId: internetMessageId,
    date: sentAt,
    ...(input.inReplyTo ? { inReplyTo: input.inReplyTo, references: [input.inReplyTo] } : {}),
  });
  if (!Buffer.isBuffer(compiled.message)) throw new Error("MESSAGE_COMPILE_FAILED");
  const raw = compiled.message as unknown as Buffer;
  const delivery = await smtpTransport.sendMail({
    envelope: { from: input.fromAddress, to: [...input.to, ...input.cc] },
    raw,
  });
  if ((delivery.rejected as string[]).length > 0 || (delivery.accepted as string[]).length === 0) throw new Error("SMTP_REJECTED");

  const objectPrefix = prefix(id, sentAt);
  const rawKey = `${objectPrefix}/raw.eml`;
  const textKey = `${objectPrefix}/body.txt`;
  const storedKeys = [rawKey, textKey];
  try {
    await putObject(rawKey, raw, "message/rfc822");
    await putObject(textKey, input.text, "text/plain; charset=utf-8");
    await pool.query(
      `INSERT INTO messages (
         id, mailbox_id, internet_message_id, sender_name, sender_address, sender_domain,
         recipient_address, recipients, cc, reply_to, subject, preview, text_object_key,
         html_object_key, raw_object_key, received_at, is_read, size_bytes, has_attachments, folder
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10,$11,$12,NULL,$13,$14,true,$15,false,'sent')`,
      [
        id, input.mailboxId, internetMessageId, input.fromName, input.fromAddress,
        input.fromAddress.split("@")[1] ?? config.EMAIL_DOMAIN, input.to[0], JSON.stringify(input.to),
        JSON.stringify(input.cc), input.subject || null, previewText(input.text), textKey, rawKey, sentAt, raw.length,
      ],
    );
  } catch (error) {
    await deleteObjects(storedKeys);
    throw error;
  }
  return { id, internetMessageId };
}
