import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { tempMailboxCreateSchema, type SessionUser } from "@aurens/shared";
import { getSessionUser } from "../auth.js";
import { config } from "../config.js";
import { pool } from "../db.js";
import { sha256 } from "../security.js";
import { deleteObjects, getObject } from "../storage.js";
import { forbidden, notFound, parseOrReply } from "./helpers.js";

interface TempMailboxRow {
  id: string;
  address: string;
  display_name: string | null;
  expires_at: Date | null;
  access_token_hash: string;
  created_at: Date;
}

function canManage(user: SessionUser | null): boolean {
  return user?.role === "owner" || user?.role === "admin";
}

function parameter(request: FastifyRequest, key: string): string {
  return (request.params as Record<string, string>)[key] ?? "";
}

function bearerToken(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7).trim();
  return token || null;
}

function matchesSecret(actual: string | null, expected: string | undefined): boolean {
  if (!actual || !expected) return false;
  const actualHash = Buffer.from(sha256(actual), "hex");
  const expectedHash = Buffer.from(sha256(expected), "hex");
  return timingSafeEqual(actualHash, expectedHash);
}

async function requireCreator(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const user = await getSessionUser(request);
  if (canManage(user) || matchesSecret(bearerToken(request), config.TEMP_MAIL_API_KEY)) return true;
  await reply.code(user ? 403 : 401).send({
    error: {
      code: user ? "FORBIDDEN" : "UNAUTHENTICATED",
      message: config.TEMP_MAIL_API_KEY
        ? "Use an owner/admin session or the configured temporary-mail API key."
        : "Sign in as an owner or administrator to create temporary mail.",
    },
  });
  return false;
}

async function loadTempMailbox(request: FastifyRequest, reply: FastifyReply): Promise<TempMailboxRow | null> {
  const result = await pool.query<TempMailboxRow>(
    `SELECT id, address, display_name, expires_at, access_token_hash, created_at
       FROM mailboxes
      WHERE id = $1 AND is_temporary = true AND is_active = true
        AND (expires_at IS NULL OR expires_at > now())`,
    [parameter(request, "id")],
  );
  const mailbox = result.rows[0];
  if (!mailbox) {
    notFound(reply, "temporary mailbox");
    return null;
  }
  const user = await getSessionUser(request);
  const token = bearerToken(request);
  if (!canManage(user) && sha256(token ?? "") !== mailbox.access_token_hash) {
    await forbidden(reply);
    return null;
  }
  return mailbox;
}

function publicMailbox(mailbox: TempMailboxRow) {
  return {
    id: mailbox.id,
    address: mailbox.address,
    displayName: mailbox.display_name,
    expiresAt: mailbox.expires_at,
    createdAt: mailbox.created_at,
  };
}

async function removeTempMailbox(mailboxId: string): Promise<void> {
  const objects = await pool.query(
    `SELECT raw_object_key AS object_key FROM messages WHERE mailbox_id = $1
     UNION ALL SELECT text_object_key FROM messages WHERE mailbox_id = $1 AND text_object_key IS NOT NULL
     UNION ALL SELECT html_object_key FROM messages WHERE mailbox_id = $1 AND html_object_key IS NOT NULL
     UNION ALL SELECT a.object_key FROM attachments a JOIN messages m ON m.id = a.message_id WHERE m.mailbox_id = $1`,
    [mailboxId],
  );
  await pool.query("DELETE FROM mailboxes WHERE id = $1 AND is_temporary = true", [mailboxId]);
  await deleteObjects(objects.rows.map((row) => String(row.object_key)));
}

export async function registerTempMailRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/temp-mailboxes", { config: { rateLimit: { max: 30, timeWindow: "1 hour" } } }, async (request, reply) => {
    if (!(await requireCreator(request, reply))) return;
    const input = parseOrReply(tempMailboxCreateSchema, request.body ?? {}, reply);
    if (!input) return;
    const id = crypto.randomUUID();
    const accessToken = `aurens_tmp_${randomBytes(24).toString("base64url")}`;
    const expiresAt = input.ttlMinutes ? new Date(Date.now() + input.ttlMinutes * 60_000) : null;
    const attempts = input.localPart ? [input.localPart] : Array.from({ length: 5 }, () => `tmp-${randomBytes(5).toString("hex")}`);
    for (const localPart of attempts) {
      try {
        const result = await pool.query<TempMailboxRow>(
          `INSERT INTO mailboxes (id, address, display_name, is_temporary, expires_at, access_token_hash)
           VALUES ($1, $2, 'Temporary mail', true, $3, $4)
           RETURNING id, address, display_name, expires_at, access_token_hash, created_at`,
          [id, `${localPart}@${config.EMAIL_DOMAIN}`, expiresAt, sha256(accessToken)],
        );
        return reply.code(201).send({ mailbox: publicMailbox(result.rows[0]!), accessToken });
      } catch (error) {
        if ((error as { code?: string }).code !== "23505") throw error;
        if (input.localPart) return reply.code(409).send({ error: { code: "MAILBOX_EXISTS", message: "That temporary address is already in use." } });
      }
    }
    return reply.code(503).send({ error: { code: "ADDRESS_UNAVAILABLE", message: "A temporary address could not be generated. Try again." } });
  });

  app.get("/api/temp-mailboxes", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!canManage(user)) return user ? forbidden(reply) : reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } });
    const result = await pool.query(
      `SELECT mb.id, mb.address, mb.display_name, mb.expires_at, mb.created_at,
              count(m.id)::int AS message_count,
              count(m.id) FILTER (WHERE NOT m.is_read)::int AS unread_count
         FROM mailboxes mb LEFT JOIN messages m ON m.mailbox_id = mb.id
        WHERE mb.is_temporary = true AND mb.is_active = true
          AND (mb.expires_at IS NULL OR mb.expires_at > now())
        GROUP BY mb.id ORDER BY mb.created_at DESC`,
    );
    return { mailboxes: result.rows };
  });

  app.get("/api/temp-mailboxes/:id", async (request, reply) => {
    const mailbox = await loadTempMailbox(request, reply);
    return mailbox ? { mailbox: publicMailbox(mailbox) } : undefined;
  });

  app.get("/api/temp-mailboxes/:id/messages", async (request, reply) => {
    const mailbox = await loadTempMailbox(request, reply);
    if (!mailbox) return;
    const requestedLimit = Number((request.query as { limit?: string }).limit ?? 40);
    const limit = Number.isInteger(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 40;
    const result = await pool.query(
      `SELECT m.id, m.sender_name, m.sender_address, m.recipient_address, m.subject, m.preview,
              m.received_at, m.is_read, m.has_attachments, m.warning
         FROM messages m WHERE m.mailbox_id = $1 AND m.folder = 'inbox'
        ORDER BY m.received_at DESC, m.id DESC LIMIT $2`,
      [mailbox.id, limit],
    );
    return { messages: result.rows };
  });

  app.get("/api/temp-mailboxes/:id/messages/:messageId", async (request, reply) => {
    const mailbox = await loadTempMailbox(request, reply);
    if (!mailbox) return;
    const result = await pool.query(
      `SELECT m.id, m.sender_name, m.sender_address, m.recipient_address, m.recipients, m.cc, m.reply_to,
              m.subject, m.preview, m.received_at, m.has_attachments, m.warning, m.text_object_key, m.html_object_key
         FROM messages m WHERE m.id = $1 AND m.mailbox_id = $2`,
      [parameter(request, "messageId"), mailbox.id],
    );
    const message = result.rows[0];
    if (!message) return notFound(reply, "message");
    const attachments = await pool.query(
      "SELECT id, filename, content_type, content_id, disposition, size_bytes, is_suspicious FROM attachments WHERE message_id = $1 ORDER BY created_at",
      [message.id],
    );
    const [text, html] = await Promise.all([
      message.text_object_key ? getObject(String(message.text_object_key)).then((item) => item.Body?.transformToString() ?? "") : "",
      message.html_object_key ? getObject(String(message.html_object_key)).then((item) => item.Body?.transformToString() ?? "") : null,
    ]);
    delete message.text_object_key;
    delete message.html_object_key;
    return { message: { ...message, text, html, attachments: attachments.rows } };
  });

  app.get("/api/temp-mailboxes/:id/attachments/:attachmentId", async (request, reply) => {
    const mailbox = await loadTempMailbox(request, reply);
    if (!mailbox) return;
    const result = await pool.query(
      `SELECT a.filename, a.content_type, a.object_key
         FROM attachments a JOIN messages m ON m.id = a.message_id
        WHERE a.id = $1 AND m.mailbox_id = $2`,
      [parameter(request, "attachmentId"), mailbox.id],
    );
    const attachment = result.rows[0];
    if (!attachment) return notFound(reply, "attachment");
    const object = await getObject(String(attachment.object_key));
    if (!object.Body) return notFound(reply, "attachment");
    const filename = String(attachment.filename).replace(/["\\\r\n]/g, "_");
    reply.header("Content-Type", String(attachment.content_type));
    reply.header("Content-Disposition", `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    reply.header("Cache-Control", "private, no-store");
    return reply.send(Buffer.from(await object.Body.transformToByteArray()));
  });

  app.delete("/api/temp-mailboxes/:id", async (request, reply) => {
    const mailbox = await loadTempMailbox(request, reply);
    if (!mailbox) return;
    await removeTempMailbox(mailbox.id);
    return reply.code(204).send();
  });
}
