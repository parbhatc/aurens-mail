import { describe, expect, it } from "vitest";
import { iframeHtml } from "./MessageReader";
import type { Attachment } from "../types";

const attachment: Attachment = {
  id: "attachment-1",
  filename: "logo.png",
  content_type: "image/png",
  content_id: "<logo@example.com>",
  disposition: "inline",
  size_bytes: 120,
  is_suspicious: false,
};

describe("email reader document", () => {
  it("renders remote images without an extra privacy prompt", () => {
    const document = iframeHtml('<img data-remote-src="https://example.com/image.png">');

    expect(document).toContain('src="https://example.com/image.png"');
  });

  it("resolves inline content IDs through authenticated attachment downloads", () => {
    const document = iframeHtml('<img src="cid:logo@example.com">', [attachment]);

    expect(document).toContain('src="/api/attachments/attachment-1/download"');
  });
});
