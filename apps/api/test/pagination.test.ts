import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "../src/http/helpers.js";

describe("cursor pagination", () => {
  it("round-trips an opaque cursor", () => {
    const date = new Date("2026-07-18T12:00:00.000Z");
    const id = "f8b112ef-45fd-4ff3-a533-02d82ced8fc7";
    expect(decodeCursor(encodeCursor(date, id))).toEqual({ receivedAt: date.toISOString(), id });
  });
  it("rejects malformed cursors", () => expect(decodeCursor("not-valid")).toBeNull());
});

