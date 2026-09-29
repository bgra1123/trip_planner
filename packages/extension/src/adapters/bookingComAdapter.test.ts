import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../testUtils.js";
import { bookingComAdapter } from "./bookingComAdapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(__dirname, "..", "fixtures", name), "utf-8");

describe("bookingComAdapter", () => {
  it("matches booking.com hotel URLs only", () => {
    expect(bookingComAdapter.matches("https://www.booking.com/hotel/pt/alfama.html")).toBe(true);
    expect(bookingComAdapter.matches("https://www.booking.com/searchresults.html")).toBe(false);
    expect(bookingComAdapter.matches("https://www.expedia.com/hotel/1")).toBe(false);
  });

  it("extracts title, price, address, and check-in/out dates from the URL", () => {
    const document = parseHtml(fixture("booking-hotel.html"));
    const url = "https://www.booking.com/hotel/pt/ribeira.html?checkin=2026-11-04&checkout=2026-11-06";
    const candidate = bookingComAdapter.extract(document, url);

    expect(candidate).toMatchObject({
      type: "accommodation",
      title: "Ribeira Riverside Guesthouse",
      cost: { amount: 180, currency: "EUR" },
      starts_at: "2026-11-04T00:00:00.000Z",
      ends_at: "2026-11-06T00:00:00.000Z",
      place_guess: { name: "Ribeira Riverside Guesthouse", address: "Rua da Ribeira 22, Porto, Portugal" },
    });
  });

  it("returns null when the title selector can't be found at all", () => {
    const document = parseHtml("<html><body>nothing here</body></html>");
    expect(bookingComAdapter.extract(document, "https://www.booking.com/hotel/pt/x.html")).toBeNull();
  });
});
