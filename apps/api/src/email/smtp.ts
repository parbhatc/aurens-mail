import { SMTPServer, type SMTPServerDataStream, type SMTPServerSession } from "smtp-server";
import { config } from "../config.js";
import { normalizeAddress } from "../security.js";
import { ingestRawEmail, resolveMailbox } from "./ingest.js";

function smtpError(message: string, responseCode: number): Error & { responseCode: number } {
  return Object.assign(new Error(message), { responseCode });
}

async function readStream(stream: SMTPServerDataStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of stream) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
    size += chunk.length;
    if (size > config.MAX_EMAIL_SIZE) throw smtpError("Message exceeds size limit", 552);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createSmtpServer(logger: { info: (value: unknown, message?: string) => void; error: (value: unknown, message?: string) => void }) {
  return new SMTPServer({
    name: `mail.${config.EMAIL_DOMAIN}`,
    banner: `${config.EMAIL_DOMAIN} mail service`,
    authOptional: true,
    disabledCommands: ["AUTH", "STARTTLS"],
    size: config.MAX_EMAIL_SIZE,
    hidePIPELINING: false,
    onMailFrom(address, _session, callback) {
      callback(null);
    },
    onRcptTo(address, _session, callback) {
      const recipient = normalizeAddress(address.address);
      if (!recipient.endsWith(`@${config.EMAIL_DOMAIN}`)) return callback(smtpError("Relay denied", 550));
      void resolveMailbox(recipient)
        .then((mailbox) => callback(mailbox ? null : smtpError("Unknown recipient", 550)))
        .catch(() => callback(smtpError("Temporary lookup failure", 451)));
    },
    onData(stream: SMTPServerDataStream, session: SMTPServerSession, callback) {
      const sender = normalizeAddress((session.envelope.mailFrom && session.envelope.mailFrom.address) || "unknown@invalid.local");
      const recipients = session.envelope.rcptTo.map((item) => normalizeAddress(item.address));
      void readStream(stream)
        .then((raw) => ingestRawEmail(raw, sender, recipients))
        .then(() => {
          logger.info({ senderDomain: sender.split("@")[1], recipientCount: recipients.length }, "Email accepted");
          callback(null, "Message accepted for delivery");
        })
        .catch((error: unknown) => {
          logger.error({ error: error instanceof Error ? error.message : "Unknown ingestion error" }, "Email ingestion failed");
          callback(error instanceof Error ? error : smtpError("Temporary processing failure", 451));
        });
    },
  });
}
