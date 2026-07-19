import type { FastifyReply } from "fastify";
import type { ZodType } from "zod";

export function parseOrReply<T>(schema: ZodType<T>, value: unknown, reply: FastifyReply): T | null {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  void reply.code(400).send({
    error: {
      code: "VALIDATION_ERROR",
      message: "The request contains invalid data.",
      details: result.error.flatten(),
    },
  });
  return null;
}

export function forbidden(reply: FastifyReply): FastifyReply {
  return reply.code(403).send({ error: { code: "FORBIDDEN", message: "You do not have access to this resource." } });
}

export function notFound(reply: FastifyReply, entity = "resource"): FastifyReply {
  return reply.code(404).send({ error: { code: `${entity.toUpperCase()}_NOT_FOUND`, message: `The requested ${entity} was not found.` } });
}

export function encodeCursor(receivedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ receivedAt: receivedAt.toISOString(), id }), "utf8").toString("base64url");
}

export function decodeCursor(value: string): { receivedAt: string; id: string } | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const item = parsed as Record<string, unknown>;
    if (typeof item.receivedAt !== "string" || typeof item.id !== "string") return null;
    if (Number.isNaN(Date.parse(item.receivedAt))) return null;
    return { receivedAt: item.receivedAt, id: item.id };
  } catch { return null; }
}

