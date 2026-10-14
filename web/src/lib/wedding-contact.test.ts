import { describe, expect, it } from "vitest";

import { createWeddingContact, normaliseIndianMobile } from "@/lib/wedding-contact";

describe("wedding reply-to contacts", () => {
  it("normalizes a valid Indian mobile number into safe call and WhatsApp destinations", () => {
    expect(normaliseIndianMobile("98765 43210")).toBe("+919876543210");
    expect(normaliseIndianMobile("+91 (98765) 43210")).toBe("+919876543210");
    expect(normaliseIndianMobile("+91987654321")).toBeNull();
    expect(normaliseIndianMobile("javascript:alert(1)")).toBeNull();

    expect(createWeddingContact("groom", "  Coordination   Desk  ", "9876543210")).toEqual({
      role: "groom",
      name: "Coordination Desk",
      phoneDisplay: "+91 98765 43210",
      phoneHref: "tel:+919876543210",
      whatsappHref: "https://wa.me/919876543210"
    });
  });

  it("requires both a reviewed name and a valid phone number from the database", () => {
    expect(createWeddingContact("groom", "", "9876543210")).toBeNull();
    expect(createWeddingContact("groom", "Coordination Desk", "not-a-phone")).toBeNull();
    expect(createWeddingContact("bride", "Bride contact", "+919876543210")).toMatchObject({
      role: "bride",
      name: "Bride contact"
    });
  });
});
