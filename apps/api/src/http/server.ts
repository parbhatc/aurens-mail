import path from "node:path";
import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { config } from "../config.js";
import { registerRoutes } from "./routes.js";

export async function createHttpServer() {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL, redact: ["req.headers.cookie", "req.headers.authorization", "body.password"] },
    bodyLimit: 256 * 1024,
    trustProxy: true,
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });
  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:", "http:"],
        frameSrc: ["'self'", "blob:"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
  });

  app.addHook("onRequest", async (request, reply) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      const origin = request.headers.origin;
      if (origin && origin !== config.APP_ORIGIN) {
        return reply.code(403).send({ error: { code: "INVALID_ORIGIN", message: "The request origin is not allowed." } });
      }
    }
  });

  app.get("/health", async () => ({ status: "ok" }));
  await registerRoutes(app);

  if (config.NODE_ENV === "production") {
    const root = path.resolve("apps/web/dist");
    app.get("/", async (_request, reply) => reply.type("text/html; charset=utf-8").send(await readFile(path.join(root, "index.html"))));
    app.get("/assets/*", async (request, reply) => {
      const filename = (request.params as { "*": string })["*"];
      if (!/^[a-zA-Z0-9._-]+$/.test(filename)) return reply.code(404).type("text/plain").send("Not found");
      const extension = path.extname(filename).toLowerCase();
      const contentType = extension === ".js" ? "text/javascript; charset=utf-8" : extension === ".css" ? "text/css; charset=utf-8" : extension === ".map" ? "application/json" : "application/octet-stream";
      try {
        const body = await readFile(path.join(root, "assets", filename));
        return reply.header("Cache-Control", "public, max-age=31536000, immutable").type(contentType).send(body);
      } catch {
        return reply.code(404).type("text/plain").send("Not found");
      }
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "The requested endpoint was not found." } });
      return reply.code(404).type("text/plain").send("Not found");
    });
  }

  app.setErrorHandler((error, request, reply) => {
    const normalized = error instanceof Error ? error : new Error("Unknown request error");
    const details = normalized as Error & { code?: string; statusCode?: number };
    request.log.error({ error: normalized.message, code: details.code }, "Request failed");
    const statusCode = details.statusCode && details.statusCode >= 400 && details.statusCode < 500 ? details.statusCode : 500;
    return reply.code(statusCode).send({ error: { code: statusCode === 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR", message: statusCode === 500 ? "An unexpected error occurred." : normalized.message } });
  });
  return app;
}
