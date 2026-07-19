import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import sanitizeHtml from "sanitize-html";

const scrypt = promisify(scryptCallback);
const suspiciousExtensions = new Set([
  "exe", "dll", "com", "bat", "cmd", "msi", "scr", "ps1", "vbs", "js", "jar", "hta", "lnk",
]);

export function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function safeFilename(value: string | undefined): string {
  const source = (value ?? "attachment").normalize("NFKC");
  const leaf = source.split(/[\\/]/).filter(Boolean).at(-1) ?? "attachment";
  const normalized = leaf
    // Control characters are intentionally included in this filename-safety expression.
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/\0-\x1f\x7f]/g, "_")
    .replace(/\.\.+/g, ".")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180);
  return normalized || "attachment";
}

export function isSuspiciousAttachment(filename: string, contentType: string): boolean {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return suspiciousExtensions.has(extension) || contentType === "application/x-msdownload";
}

export function sanitizeEmailHtml(input: string): string {
  return sanitizeHtml(input, {
    allowedTags: [
      "a", "abbr", "address", "article", "aside", "b", "blockquote", "br", "caption", "code", "col",
      "colgroup", "dd", "del", "details", "div", "dl", "dt", "em", "figcaption", "figure", "footer",
      "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i", "img", "ins", "kbd", "li", "main",
      "mark", "ol", "p", "pre", "q", "s", "section", "small", "span", "strong", "sub", "summary",
      "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul",
    ],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title", "width", "height", "data-remote-src"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan", "scope"],
      col: ["span"],
    },
    allowedSchemes: ["http", "https", "mailto", "cid"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    enforceHtmlBoundary: true,
    transformTags: {
      a: (_tagName, attrs) => ({
        tagName: "a",
        attribs: {
          ...(attrs.href ? { href: attrs.href } : {}),
          ...(attrs.title ? { title: attrs.title } : {}),
          target: "_blank",
          rel: "noopener noreferrer nofollow",
        },
      }),
      img: (_tagName, attrs) => {
        const src = attrs.src ?? "";
        const isRemote = /^https?:\/\//i.test(src);
        return {
          tagName: "img",
          attribs: {
            ...(isRemote ? { "data-remote-src": src } : {}),
            ...(!isRemote && /^cid:/i.test(src) ? { src } : {}),
            ...(attrs.alt ? { alt: attrs.alt } : { alt: "" }),
            ...(attrs.width ? { width: attrs.width } : {}),
            ...(attrs.height ? { height: attrs.height } : {}),
          },
        };
      },
    },
    exclusiveFilter(frame) {
      if (frame.tag === "a" && frame.attribs.href && /^(?:javascript|data|file):/i.test(frame.attribs.href)) return true;
      return false;
    },
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("base64url")}:${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, saltText, hashText] = stored.split(":");
  if (algorithm !== "scrypt" || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64url");
  const actual = (await scrypt(password, Buffer.from(saltText, "base64url"), expected.length)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function newSessionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: sha256(token) };
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function previewText(value: string, maxLength = 240): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}
