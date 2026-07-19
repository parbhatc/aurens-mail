import { simpleParser, type AddressObject, type Attachment } from "mailparser";
import { isSuspiciousAttachment, previewText, safeFilename, sanitizeEmailHtml } from "../security.js";

export interface ParsedAttachment {
  id: string;
  filename: string;
  contentType: string;
  contentId: string | null;
  disposition: string | null;
  content: Buffer;
  suspicious: boolean;
}

export interface ParsedEmail {
  internetMessageId: string | null;
  senderName: string | null;
  senderAddress: string;
  recipients: string[];
  cc: string[];
  replyTo: string | null;
  subject: string | null;
  receivedAt: Date;
  text: string;
  html: string | null;
  preview: string;
  attachments: ParsedAttachment[];
}

function addressList(value: AddressObject | AddressObject[] | undefined): Array<{ name: string; address: string }> {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.flatMap((entry) => entry.value).flatMap((entry) => {
    const address = entry.address?.trim().toLowerCase();
    return address ? [{ name: entry.name ?? "", address }] : [];
  });
}

function mapAttachment(attachment: Attachment): ParsedAttachment {
  const filename = safeFilename(attachment.filename);
  const contentType = attachment.contentType || "application/octet-stream";
  return {
    id: crypto.randomUUID(),
    filename,
    contentType,
    contentId: attachment.contentId ?? null,
    disposition: attachment.contentDisposition ?? null,
    content: attachment.content,
    suspicious: isSuspiciousAttachment(filename, contentType),
  };
}

export async function parseEmail(raw: Buffer, envelopeSender: string): Promise<ParsedEmail> {
  const parsed = await simpleParser(raw, {
    skipImageLinks: true,
    maxHtmlLengthToParse: 10 * 1024 * 1024,
  });
  const from = addressList(parsed.from)[0];
  const to = addressList(parsed.to).map((item) => item.address);
  const cc = addressList(parsed.cc).map((item) => item.address);
  const replyTo = addressList(parsed.replyTo)[0]?.address ?? null;
  const text = parsed.text?.trim() ?? "";
  const htmlSource = typeof parsed.html === "string" ? parsed.html : null;
  const attachments = parsed.attachments.map(mapAttachment);

  return {
    internetMessageId: parsed.messageId?.trim() || null,
    senderName: from?.name.trim() || null,
    senderAddress: from?.address ?? (envelopeSender.trim().toLowerCase() || "unknown@invalid.local"),
    recipients: to,
    cc,
    replyTo,
    subject: parsed.subject?.trim() || null,
    receivedAt: parsed.date instanceof Date && !Number.isNaN(parsed.date.getTime()) ? parsed.date : new Date(),
    text,
    html: htmlSource ? sanitizeEmailHtml(htmlSource) : null,
    preview: previewText(text || (htmlSource ? sanitizeEmailHtml(htmlSource).replace(/<[^>]*>/g, " ") : "")),
    attachments,
  };
}
