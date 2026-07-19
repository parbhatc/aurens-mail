import type { FastifyReply, FastifyRequest } from "fastify";
import type { SessionUser } from "@aurens/shared";
import { config } from "./config.js";
import { pool } from "./db.js";
import { newSessionToken, sha256, verifyPassword } from "./security.js";

const SESSION_COOKIE = "aurens_mail_session";

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: SessionUser["role"];
  password_hash: string;
}

export function sessionCookieName(): string { return SESSION_COOKIE; }

export async function login(email: string, password: string): Promise<{ user: SessionUser; token: string } | null> {
  const result = await pool.query<UserRow>(
    "SELECT id, email, display_name, role, password_hash FROM users WHERE email = $1 AND is_active = true",
    [email],
  );
  const row = result.rows[0];
  if (!row || !(await verifyPassword(password, row.password_hash))) return null;
  const session = newSessionToken();
  await pool.query(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + interval '30 days')`,
    [crypto.randomUUID(), row.id, session.hash],
  );
  return {
    user: { id: row.id, email: row.email, displayName: row.display_name, role: row.role },
    token: session.token,
  };
}

export async function logout(request: FastifyRequest): Promise<void> {
  const token = request.cookies[SESSION_COOKIE];
  if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
}

export async function getSessionUser(request: FastifyRequest): Promise<SessionUser | null> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return null;
  const result = await pool.query<UserRow>(
    `SELECT u.id, u.email, u.display_name, u.role, u.password_hash
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.is_active = true`,
    [sha256(token)],
  );
  const row = result.rows[0];
  return row ? { id: row.id, email: row.email, displayName: row.display_name, role: row.role } : null;
}

export async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<SessionUser | null> {
  const user = await getSessionUser(request);
  if (!user) {
    await reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } });
    return null;
  }
  return user;
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: "strict",
    maxAge: 30 * 24 * 60 * 60,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

