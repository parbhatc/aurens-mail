import { describe, expect, it } from "vitest";
import { sendMessageSchema } from "@aurens/shared";

describe("outbound message validation", () => {
  it("accepts a valid reply payload", () => {
    const value = sendMessageSchema.parse({
      mailboxId: "e838a3c7-1776-4720-8ab6-c0e75ee7a328",
      to: ["PERSON@EXAMPLE.COM"],
      subject: "Re: Hello",
      text: "Thanks for writing.",
      replyToMessageId: "55f8cc91-6665-49a7-9b53-76921598b360",
    });
    expect(value.to).toEqual(["person@example.com"]);
    expect(value.cc).toEqual([]);
  });

  it("rejects header injection and empty bodies", () => {
    const base = {
      mailboxId: "e838a3c7-1776-4720-8ab6-c0e75ee7a328",
      to: ["person@example.com"],
      text: "Body",
    };
    expect(sendMessageSchema.safeParse({ ...base, subject: "Hello\r\nBcc: attacker@example.com" }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ ...base, subject: "Hello", text: "   " }).success).toBe(false);
  });
});
