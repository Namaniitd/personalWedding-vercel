import { describe, expect, it } from "vitest";

import { buildInvitationLinkCsv } from "@/lib/invitation-link-csv";

describe("one-time invitation link CSV", () => {
  it("preserves names, formatted numbers and links while escaping spreadsheet formulas and quotes", () => {
    const csv = buildInvitationLinkCsv([{ householdName: { en: '=Family "One", test', hi: "परिवार" }, preferredLocale: "en", contactNumber: "+91 90000 00000", invitationUrl: "https://example.test/i/g/synthetic-token" }]);
    expect(csv).toContain('"name","contactnumber","invitationurl"');
    expect(csv).toContain('"\'=Family ""One"", test"');
    expect(csv).toContain('"\'+91 90000 00000"');
    expect(csv).toContain('"https://example.test/i/g/synthetic-token"');
  });
});
