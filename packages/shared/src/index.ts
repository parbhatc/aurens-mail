import { z } from "zod";

export const roleSchema = z.enum(["owner", "admin", "member"]);
export const folderSchema = z.enum(["inbox", "sent", "spam", "trash"]);

export const loginSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  password: z.string().min(5).max(256),
});

export const mailboxCreateSchema = z.object({
  address: z.email().transform((value) => value.toLowerCase()),
  displayName: z.string().trim().min(1).max(100).optional(),
  isCatchAll: z.boolean().default(false),
});

export const mailboxPatchSchema = z.object({
  displayName: z.string().trim().min(1).max(100).nullable().optional(),
  isActive: z.boolean().optional(),
  isCatchAll: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const messagePatchSchema = z.object({
  isRead: z.boolean().optional(),
  isStarred: z.boolean().optional(),
  folder: folderSchema.optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required");

const recipientListSchema = z.array(z.email().transform((value) => value.toLowerCase())).min(1).max(20);
export const sendMessageSchema = z.object({
  mailboxId: z.uuid(),
  to: recipientListSchema,
  cc: z.array(z.email().transform((value) => value.toLowerCase())).max(20).default([]),
  subject: z.string().trim().max(500).refine((value) => !/[\r\n]/.test(value), "Subject cannot contain line breaks"),
  text: z.string().trim().min(1).max(200_000),
  replyToMessageId: z.uuid().optional(),
});

const booleanQuery = z.enum(["true", "false"]).transform((value) => value === "true");
export const messageQuerySchema = z.object({
  mailbox: z.uuid().optional(),
  folder: folderSchema.default("inbox"),
  search: z.string().trim().max(200).optional(),
  unread: booleanQuery.optional(),
  starred: booleanQuery.optional(),
  hasAttachment: booleanQuery.optional(),
  sender: z.string().trim().max(320).optional(),
  recipient: z.string().trim().max(320).optional(),
  dateFrom: z.iso.datetime({ offset: true }).optional(),
  dateTo: z.iso.datetime({ offset: true }).optional(),
  cursor: z.string().max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

export const userCreateSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  displayName: z.string().trim().min(1).max(100).optional(),
  password: z.string().min(5).max(256),
  role: roleSchema.default("member"),
  mailboxIds: z.array(z.uuid()).max(100).default([]),
});

export type Role = z.infer<typeof roleSchema>;
export type Folder = z.infer<typeof folderSchema>;
export type MessageQuery = z.infer<typeof messageQuerySchema>;

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string | null;
  role: Role;
}
