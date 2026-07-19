import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  loginSchema, mailboxCreateSchema, mailboxPatchSchema, messagePatchSchema, messageQuerySchema, sendMessageSchema, userCreateSchema,
  type Role, type SessionUser,
} from "@aurens/shared";
import { clearSessionCookie, login, logout, requireUser, setSessionCookie } from "../auth.js";
import { config } from "../config.js";
import { pool, withTransaction } from "../db.js";
import { deleteObjects, getObject } from "../storage.js";
import { hashPassword } from "../security.js";
import { decodeCursor, encodeCursor, forbidden, notFound, parseOrReply } from "./helpers.js";
import { sendAndStoreOutbound } from "../email/outbound.js";

function canManage(user: SessionUser): boolean { return user.role === "owner" || user.role === "admin"; }
function roleCanCreate(actor: Role, requested: Role): boolean {
  return actor === "owner" || (actor === "admin" && requested === "member");
}

async function canAccessMailbox(user: SessionUser, mailboxId: string): Promise<boolean> {
  if (canManage(user)) return true;
  const result = await pool.query("SELECT 1 FROM user_mailboxes WHERE user_id = $1 AND mailbox_id = $2", [user.id, mailboxId]);
  return (result.rowCount ?? 0) > 0;
}

async function loadAuthorizedMessage(user: SessionUser, messageId: string) {
  const result = await pool.query(
    `SELECT m.*, mb.address AS mailbox_address, mb.display_name AS mailbox_display_name
       FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id
      WHERE m.id = $1
        AND ($2::boolean OR EXISTS (
          SELECT 1 FROM user_mailboxes um WHERE um.user_id = $3 AND um.mailbox_id = m.mailbox_id
        ))`,
    [messageId, canManage(user), user.id],
  );
  return result.rows[0] as Record<string, unknown> | undefined;
}

function param(request: FastifyRequest, key: string): string {
  const params = request.params as Record<string, string>;
  return params[key] ?? "";
}

async function sendStoredObject(reply: FastifyReply, key: string, contentType: string, disposition?: string) {
  const object = await getObject(key);
  if (!object.Body) return notFound(reply, "object");
  const body = await object.Body.transformToByteArray();
  reply.header("Content-Type", contentType);
  reply.header("Cache-Control", "private, no-store");
  if (disposition) reply.header("Content-Disposition", disposition);
  return reply.send(Buffer.from(body));
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/login", { config: { rateLimit: { max: 8, timeWindow: "15 minutes" } } }, async (request, reply) => {
    const input = parseOrReply(loginSchema, request.body, reply);
    if (!input) return;
    const session = await login(input.email, input.password);
    if (!session) return reply.code(401).send({ error: { code: "INVALID_CREDENTIALS", message: "The email or password is incorrect." } });
    setSessionCookie(reply, session.token);
    return { user: session.user };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    await logout(request);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.get("/api/session", async (request, reply) => {
    const user = await requireUser(request, reply);
    return user ? { user } : undefined;
  });

  app.get("/api/mailboxes", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const result = await pool.query(
      `SELECT mb.id, mb.address, mb.display_name, mb.is_active, mb.is_catch_all,
              count(m.id) FILTER (WHERE m.folder = 'inbox' AND NOT m.is_read)::int AS unread_count
         FROM mailboxes mb
         LEFT JOIN messages m ON m.mailbox_id = mb.id
        WHERE $1::boolean OR EXISTS (
          SELECT 1 FROM user_mailboxes um WHERE um.user_id = $2 AND um.mailbox_id = mb.id
        )
        GROUP BY mb.id ORDER BY mb.address`,
      [canManage(user), user.id],
    );
    return { mailboxes: result.rows };
  });

  app.post("/api/mailboxes", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    if (!canManage(user)) return forbidden(reply);
    const input = parseOrReply(mailboxCreateSchema, request.body, reply); if (!input) return;
    if (!input.address.endsWith(`@${config.EMAIL_DOMAIN}`)) return reply.code(400).send({ error: { code: "INVALID_DOMAIN", message: `Mailbox addresses must use @${config.EMAIL_DOMAIN}.` } });
    const id = crypto.randomUUID();
    try {
      const result = await pool.query(
        `INSERT INTO mailboxes (id, address, display_name, is_catch_all) VALUES ($1,$2,$3,$4)
         RETURNING id, address, display_name, is_active, is_catch_all`,
        [id, input.address, input.displayName ?? null, input.isCatchAll],
      );
      return reply.code(201).send({ mailbox: result.rows[0] });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: { code: "MAILBOX_EXISTS", message: "That mailbox already exists or a catch-all is already configured." } });
      throw error;
    }
  });

  app.patch("/api/mailboxes/:id", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    if (!canManage(user)) return forbidden(reply);
    const input = parseOrReply(mailboxPatchSchema, request.body, reply); if (!input) return;
    const result = await pool.query(
      `UPDATE mailboxes SET
         display_name = CASE WHEN $2::boolean THEN $3 ELSE display_name END,
         is_active = COALESCE($4, is_active), is_catch_all = COALESCE($5, is_catch_all), updated_at = now()
       WHERE id = $1 RETURNING id, address, display_name, is_active, is_catch_all`,
      [param(request, "id"), "displayName" in input, input.displayName ?? null, input.isActive ?? null, input.isCatchAll ?? null],
    );
    return result.rows[0] ? { mailbox: result.rows[0] } : notFound(reply, "mailbox");
  });

  app.delete("/api/mailboxes/:id", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    if (!canManage(user)) return forbidden(reply);
    const result = await pool.query("UPDATE mailboxes SET is_active = false, updated_at = now() WHERE id = $1 RETURNING id", [param(request, "id")]);
    return result.rows[0] ? reply.code(204).send() : notFound(reply, "mailbox");
  });

  const listMessages = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const input = parseOrReply(messageQuerySchema, request.query, reply); if (!input) return;
    if (input.mailbox && !(await canAccessMailbox(user, input.mailbox))) return forbidden(reply);
    const values: unknown[] = [input.folder, canManage(user), user.id];
    const clauses = ["m.folder = $1", "($2::boolean OR EXISTS (SELECT 1 FROM user_mailboxes um WHERE um.user_id = $3 AND um.mailbox_id = m.mailbox_id))"];
    const add = (clause: string, value: unknown) => { values.push(value); clauses.push(clause.replace("?", `$${values.length}`)); };
    if (input.mailbox) add("m.mailbox_id = ?", input.mailbox);
    if (input.unread !== undefined) add("m.is_read = ?", !input.unread);
    if (input.starred !== undefined) add("m.is_starred = ?", input.starred);
    if (input.hasAttachment !== undefined) add("m.has_attachments = ?", input.hasAttachment);
    if (input.sender) add("m.sender_address ILIKE '%' || ? || '%'", input.sender);
    if (input.recipient) add("m.recipient_address ILIKE '%' || ? || '%'", input.recipient);
    if (input.dateFrom) add("m.received_at >= ?", input.dateFrom);
    if (input.dateTo) add("m.received_at <= ?", input.dateTo);
    if (input.search) {
      values.push(input.search);
      clauses.push(`(m.sender_address ILIKE '%' || $${values.length} || '%' OR coalesce(m.sender_name,'') ILIKE '%' || $${values.length} || '%' OR coalesce(m.subject,'') ILIKE '%' || $${values.length} || '%' OR m.recipient_address ILIKE '%' || $${values.length} || '%' OR m.preview ILIKE '%' || $${values.length} || '%' OR mb.address ILIKE '%' || $${values.length} || '%')`);
    }
    if (input.cursor) {
      const cursor = decodeCursor(input.cursor);
      if (!cursor) return reply.code(400).send({ error: { code: "INVALID_CURSOR", message: "The pagination cursor is invalid." } });
      values.push(cursor.receivedAt, cursor.id);
      clauses.push(`(m.received_at, m.id) < ($${values.length - 1}, $${values.length})`);
    }
    values.push(input.limit + 1);
    const result = await pool.query(
      `SELECT m.id, m.sender_name, m.sender_address, m.recipient_address, m.subject, m.preview,
              m.received_at, m.is_read, m.is_starred, m.folder, m.has_attachments, m.warning,
              mb.id AS mailbox_id, mb.address AS mailbox_address, mb.display_name AS mailbox_display_name
         FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id
        WHERE ${clauses.join(" AND ")}
        ORDER BY m.received_at DESC, m.id DESC LIMIT $${values.length}`,
      values,
    );
    const hasMore = result.rows.length > input.limit;
    const rows = result.rows.slice(0, input.limit);
    const last = rows.at(-1) as { received_at: Date; id: string } | undefined;
    return { messages: rows, nextCursor: hasMore && last ? encodeCursor(last.received_at, last.id) : null };
  };
  app.get("/api/messages", listMessages);
  app.get("/api/search", listMessages);

  app.post("/api/messages/send", { config: { rateLimit: { max: 30, timeWindow: "1 hour" } } }, async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const input = parseOrReply(sendMessageSchema, request.body, reply); if (!input) return;
    const mailboxResult = await pool.query(
      `SELECT mb.id, mb.address, mb.display_name
         FROM mailboxes mb
        WHERE mb.id = $1 AND mb.is_active = true
          AND ($2::boolean OR EXISTS (
            SELECT 1 FROM user_mailboxes um WHERE um.user_id = $3 AND um.mailbox_id = mb.id
          ))`,
      [input.mailboxId, canManage(user), user.id],
    );
    const mailbox = mailboxResult.rows[0] as { id: string; address: string; display_name: string | null } | undefined;
    if (!mailbox) return forbidden(reply);
    let inReplyTo: string | undefined;
    if (input.replyToMessageId) {
      const original = await loadAuthorizedMessage(user, input.replyToMessageId);
      if (!original) return notFound(reply, "message");
      if (typeof original.internet_message_id === "string" && original.internet_message_id) inReplyTo = original.internet_message_id;
    }
    try {
      const sent = await sendAndStoreOutbound({
        mailboxId: mailbox.id,
        fromAddress: mailbox.address,
        fromName: mailbox.display_name,
        to: input.to,
        cc: input.cc,
        subject: input.subject,
        text: input.text,
        ...(inReplyTo ? { inReplyTo } : {}),
      });
      request.log.info({ messageId: sent.id, recipientCount: input.to.length + input.cc.length }, "Outbound message accepted");
      return reply.code(201).send({ message: { id: sent.id, internetMessageId: sent.internetMessageId }, status: "queued" });
    } catch (error) {
      if (error instanceof Error && error.message === "OUTBOUND_DISABLED") {
        return reply.code(503).send({ error: { code: "OUTBOUND_NOT_CONFIGURED", message: "Outbound mail is not enabled yet." } });
      }
      request.log.error({ error: error instanceof Error ? error.message : "Unknown outbound error" }, "Outbound send failed");
      return reply.code(502).send({ error: { code: "SEND_FAILED", message: "The message could not be accepted by the outgoing mail server." } });
    }
  });

  app.get("/api/messages/:id", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const message = await loadAuthorizedMessage(user, param(request, "id"));
    if (!message) return notFound(reply, "message");
    const attachments = await pool.query(
      "SELECT id, filename, content_type, content_id, disposition, size_bytes, is_suspicious FROM attachments WHERE message_id = $1 ORDER BY created_at",
      [param(request, "id")],
    );
    const text = message.text_object_key ? await getObject(String(message.text_object_key)).then((item) => item.Body?.transformToString() ?? "") : "";
    const html = message.html_object_key ? await getObject(String(message.html_object_key)).then((item) => item.Body?.transformToString() ?? "") : null;
    return { message: { ...message, text, html, attachments: attachments.rows } };
  });

  app.patch("/api/messages/:id", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const message = await loadAuthorizedMessage(user, param(request, "id")); if (!message) return notFound(reply, "message");
    const input = parseOrReply(messagePatchSchema, request.body, reply); if (!input) return;
    const result = await pool.query(
      `UPDATE messages SET is_read = COALESCE($2::boolean, is_read), is_starred = COALESCE($3::boolean, is_starred),
         previous_folder = CASE WHEN $4::message_folder = 'trash' THEN folder WHEN $4::message_folder IS NOT NULL AND $4::message_folder <> 'trash' THEN NULL ELSE previous_folder END,
         folder = CASE WHEN folder = 'trash' AND $4::message_folder = 'inbox' AND previous_folder IS NOT NULL THEN previous_folder ELSE COALESCE($4::message_folder, folder) END,
         deleted_at = CASE WHEN $4::message_folder = 'trash' THEN now() WHEN $4::message_folder IS NOT NULL THEN NULL ELSE deleted_at END
       WHERE id = $1 RETURNING id, is_read, is_starred, folder, deleted_at`,
      [param(request, "id"), input.isRead ?? null, input.isStarred ?? null, input.folder ?? null],
    );
    return { message: result.rows[0] };
  });

  app.delete("/api/messages/:id", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const message = await loadAuthorizedMessage(user, param(request, "id")); if (!message) return notFound(reply, "message");
    if (message.folder !== "trash") return reply.code(409).send({ error: { code: "MESSAGE_NOT_IN_TRASH", message: "Move the message to trash before permanently deleting it." } });
    const attachmentResult = await pool.query("SELECT object_key FROM attachments WHERE message_id = $1", [param(request, "id")]);
    const keys = [message.raw_object_key, message.text_object_key, message.html_object_key, ...attachmentResult.rows.map((row) => row.object_key)]
      .filter((key): key is string => typeof key === "string");
    await pool.query("DELETE FROM messages WHERE id = $1", [param(request, "id")]);
    await deleteObjects(keys);
    return reply.code(204).send();
  });

  app.get("/api/messages/:id/raw", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const message = await loadAuthorizedMessage(user, param(request, "id")); if (!message) return notFound(reply, "message");
    return sendStoredObject(reply, String(message.raw_object_key), "message/rfc822", `attachment; filename="message-${param(request, "id")}.eml"`);
  });

  app.get("/api/attachments/:id/download", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const result = await pool.query(
      `SELECT a.*, m.mailbox_id FROM attachments a JOIN messages m ON m.id = a.message_id WHERE a.id = $1`,
      [param(request, "id")],
    );
    const item = result.rows[0] as Record<string, unknown> | undefined;
    if (!item) return notFound(reply, "attachment");
    if (!(await canAccessMailbox(user, String(item.mailbox_id)))) return forbidden(reply);
    const filename = String(item.filename).replace(/["\\\r\n]/g, "_");
    return sendStoredObject(reply, String(item.object_key), String(item.content_type), `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  });

  app.get("/api/users", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    if (!canManage(user)) return forbidden(reply);
    const result = await pool.query(
      `SELECT u.id, u.email, u.display_name, u.role, u.is_active,
              coalesce(json_agg(um.mailbox_id) FILTER (WHERE um.mailbox_id IS NOT NULL), '[]') AS mailbox_ids
         FROM users u LEFT JOIN user_mailboxes um ON um.user_id = u.id GROUP BY u.id ORDER BY u.created_at`,
    );
    return { users: result.rows };
  });

  app.post("/api/users", async (request, reply) => {
    const actor = await requireUser(request, reply); if (!actor) return;
    if (!canManage(actor)) return forbidden(reply);
    const input = parseOrReply(userCreateSchema, request.body, reply); if (!input) return;
    if (!roleCanCreate(actor.role, input.role)) return forbidden(reply);
    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(input.password);
    try {
      await withTransaction(async (client) => {
        await client.query("INSERT INTO users (id,email,display_name,role,password_hash) VALUES ($1,$2,$3,$4,$5)", [id, input.email, input.displayName ?? null, input.role, passwordHash]);
        for (const mailboxId of input.mailboxIds) await client.query("INSERT INTO user_mailboxes (user_id,mailbox_id) VALUES ($1,$2)", [id, mailboxId]);
      });
      return reply.code(201).send({ user: { id, email: input.email, displayName: input.displayName ?? null, role: input.role } });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: { code: "USER_EXISTS", message: "That user already exists." } });
      throw error;
    }
  });
}
