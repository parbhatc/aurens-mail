import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseEmail } from "../src/email/parser.js";
import { isSuspiciousAttachment, safeFilename, sanitizeEmailHtml } from "../src/security.js";

const fixture = (name: string) => readFile(path.resolve("apps/api/test/fixtures", name));

describe("email parser", () => {
  it("parses plain-text metadata and body", async () => {
    const result = await parseEmail(await fixture("plain.eml"), "bounce@example.com");
    expect(result.senderAddress).toBe("alice@example.com");
    expect(result.recipients).toEqual(["support@aurens.app"]);
    expect(result.subject).toBe("Plain text test");
    expect(result.text).toContain("plain text message");
    expect(result.preview).toContain("Hello support");
  });

  it("supports multipart alternative and unicode names", async () => {
    const result = await parseEmail(await fixture("html.eml"), "zoe@example.net");
    expect(result.senderName).toBe("Zoë Sender");
    expect(result.text).toBe("Safe fallback text.");
    expect(result.html).toContain("<b>admin</b>");
  });

  it("extracts multiple attachments and sanitizes traversal filenames", async () => {
    const result = await parseEmail(await fixture("attachment.eml"), "files@example.org");
    expect(result.attachments).toHaveLength(2);
    expect(result.attachments[0]?.filename).toBe("notes.txt");
    expect(result.attachments[0]?.content.toString()).toContain("test attachment");
    expect(result.attachments[1]?.suspicious).toBe(true);
  });

  it("handles missing subject and malformed but recoverable MIME", async () => {
    const raw = Buffer.from("From: sender@example.com\r\nTo: support@aurens.app\r\nContent-Type: text/plain\r\n\r\nHello");
    const result = await parseEmail(raw, "sender@example.com");
    expect(result.subject).toBeNull();
    expect(result.text).toBe("Hello");
  });
});

describe("untrusted content security", () => {
  it("removes scripts, forms, event handlers, and javascript links", () => {
    const result = sanitizeEmailHtml('<script>x()</script><form>bad</form><p onclick="x()">safe</p><a href="javascript:x()">click</a>');
    expect(result).not.toMatch(/script|form|onclick|javascript/i);
    expect(result).toContain("safe");
  });

  it("blocks remote images until explicitly loaded", () => {
    const result = sanitizeEmailHtml('<img src="https://example.com/tracker.png" alt="tracker">');
    expect(result).toContain('data-remote-src="https://example.com/tracker.png"');
    expect(result).not.toMatch(/(?:^|\s)src="https:\/\//);
  });

  it("normalizes dangerous filenames", () => {
    expect(safeFilename("../../../../etc/passwd")).toBe("passwd");
    expect(safeFilename("..\\..\\payload.exe")).toBe("payload.exe");
    expect(isSuspiciousAttachment("payload.exe", "application/octet-stream")).toBe(true);
  });
});
