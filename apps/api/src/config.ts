import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HTTP_HOST: z.string().default("127.0.0.1"),
  HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  SMTP_HOST: z.string().default("127.0.0.1"),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(2525),
  OUTBOUND_ENABLED: z.enum(["true", "false"]).transform((value) => value === "true").default(false),
  OUTBOUND_SMTP_HOST: z.string().default("host.docker.internal"),
  OUTBOUND_SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(2587),
  OUTBOUND_SMTP_SECURE: z.enum(["true", "false"]).transform((value) => value === "true").default(false),
  OUTBOUND_SMTP_REQUIRE_TLS: z.enum(["true", "false"]).transform((value) => value === "true").default(false),
  OUTBOUND_SMTP_USER: z.string().optional(),
  OUTBOUND_SMTP_PASSWORD: z.string().optional(),
  DATABASE_URL: z.string().min(1),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  EMAIL_DOMAIN: z.string().transform((value) => value.toLowerCase()).default("aurens.app"),
  APP_ORIGIN: z.url(),
  COOKIE_SECURE: z.enum(["true", "false"]).transform((value) => value === "true").default(false),
  MAX_EMAIL_SIZE: z.coerce.number().int().positive().default(26_214_400),
  MAX_ATTACHMENT_SIZE: z.coerce.number().int().positive().default(15_728_640),
  MAX_ATTACHMENTS: z.coerce.number().int().positive().max(200).default(50),
  TRASH_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  SPAM_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  OWNER_EMAIL: z.email().transform((value) => value.toLowerCase()),
  OWNER_PASSWORD: z.string().min(5),
  LOG_LEVEL: z.string().default("info"),
}).refine((value) => Boolean(value.OUTBOUND_SMTP_USER) === Boolean(value.OUTBOUND_SMTP_PASSWORD), {
  message: "OUTBOUND_SMTP_USER and OUTBOUND_SMTP_PASSWORD must be configured together",
});

export type Config = z.infer<typeof configSchema>;
export const config = configSchema.parse(process.env);
