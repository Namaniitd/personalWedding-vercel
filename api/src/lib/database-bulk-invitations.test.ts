import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(), release: vi.fn(), connect: vi.fn(), configuration: vi.fn(),
  lock: vi.fn(), issue: vi.fn(), validate: vi.fn(), contact: vi.fn()
}));

vi.mock("./database-rsvps", () => ({ getDatabasePool: () => ({ connect: mocks.connect }) }));
vi.mock("./database-content-lock", () => ({ lockDatabaseContentAndInvitationIssue: mocks.lock }));
vi.mock("./database-wedding-content", () => ({ loadDatabaseWeddingConfiguration: mocks.configuration }));
vi.mock("./database-invitations", async (importOriginal) => ({
  ...await importOriginal<typeof import("./database-invitations")>(),
  issueDatabaseInvitationInTransaction: mocks.issue,
  validateDatabaseInvitationIssueForConfiguration: mocks.validate,
  validateDatabaseInvitationContactRoleForConfiguration: mocks.contact
}));

import { issueDatabaseBulkInvitations, parseBulkInvitationCsv } from "./database-bulk-invitations";

const client = { query: mocks.query, release: mocks.release };
const configuration = { events: [{ event: { id: "event-one" } }] };
const input = {
  csv: "name,contactnumber\nSample Guest,+1 202 555 0101\nAnother Guest,+1 202 555 0102",
  preferredLocale: "en" as const,
  contactRole: "bride" as const,
  eventLimits: [{ eventId: "event-one", adults: 2, children: 0 }]
};

describe("bulk invitation CSV", () => {
  it("accepts quoted names, Unicode, BOM, reordered columns and formatted numbers", () => {
    expect(parseBulkInvitationCsv('\uFEFFContact Number,Name\r\n+1 202 555 0101,"Guest, Family"\r\n+1 202 555 0102,परीक्षण परिवार')).toEqual([
      { name: "Guest, Family", contactNumber: "+1 202 555 0101", rowNumber: 2 },
      { name: "परीक्षण परिवार", contactNumber: "+1 202 555 0102", rowNumber: 3 }
    ]);
  });

  it.each([
    ["name,phone\nSample Guest,+12025550101", "header"],
    ["name,contactnumber\n", "at least one"],
    ["name,contactnumber\nA,+12025550101", "Row 2"],
    ["name,contactnumber\nSample Guest,", "Row 2"],
    ["name,contactnumber\nSample Guest,123", "Row 2"],
    ["name,contactnumber\nSample Guest,hello", "Row 2"],
    ['name,contactnumber\n"Unclosed,+12025550101', "CSV is invalid"],
    ["name,contactnumber\nSample Guest,+12025550101,extra", "CSV is invalid"],
    ["name,contactnumber\nSample Guest,+1 202 555 0101\nAnother Guest,1 (202) 555-0101", "row 2"]
  ])("rejects invalid files with a useful error", (csv, message) => {
    expect(() => parseBulkInvitationCsv(csv)).toThrow(message);
  });

  it("caps uploads by byte length and guest count", () => {
    expect(() => parseBulkInvitationCsv("अ".repeat(90_000))).toThrow("256 KiB");
    const guests = Array.from({ length: 201 }, (_, index) => `Sample Guest ${index},1202555${String(index).padStart(4, "0")}`);
    expect(() => parseBulkInvitationCsv(`name,contactnumber\n${guests.join("\n")}`)).toThrow("at most 200");
  });
});

describe("bulk invitation transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockReset().mockResolvedValue({ rows: [] });
    mocks.connect.mockResolvedValue(client);
    mocks.configuration.mockResolvedValue(configuration);
    mocks.contact.mockReturnValue({ ok: true });
    mocks.validate.mockReset().mockImplementation((value) => ({ ok: true, value }));
    mocks.issue.mockReset().mockImplementation(async (_client, value, side) => ({ householdName: { en: value.householdNameEn }, contactNumber: value.contactNumber, side }));
  });

  it("uses one locked transaction and validates every row before the first insert", async () => {
    const issued = await issueDatabaseBulkInvitations(input, "bride");
    expect(issued).toHaveLength(2);
    expect(mocks.lock).toHaveBeenCalledWith(client, "bride");
    expect(mocks.configuration).toHaveBeenCalledWith(client, "bride");
    expect(mocks.validate).toHaveBeenCalledTimes(2);
    expect(mocks.validate.mock.invocationCallOrder[1]).toBeLessThan(mocks.issue.mock.invocationCallOrder[0]);
    expect(mocks.issue.mock.calls.every(([usedClient, , side, usedConfiguration]) =>
      usedClient === client && side === "bride" && usedConfiguration === configuration)).toBe(true);
    expect(mocks.query.mock.calls.map(([query]) => query)).toEqual(["begin", "commit"]);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("rejects bad CSV before opening a database connection", async () => {
    await expect(issueDatabaseBulkInvitations({ ...input, csv: "name,contactnumber\nSample Guest," }, "bride")).rejects.toThrow("Row 2");
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("creates nothing when validation fails for a later row", async () => {
    mocks.validate.mockImplementationOnce((value) => ({ ok: true, value })).mockReturnValueOnce({ ok: false, message: "Event unavailable." });
    await expect(issueDatabaseBulkInvitations(input, "bride")).rejects.toThrow("Row 3: Event unavailable.");
    expect(mocks.issue).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls.map(([query]) => query)).toEqual(["begin", "rollback"]);
  });

  it("rolls back the entire batch after any insertion failure", async () => {
    mocks.issue.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("Insert failed"));
    await expect(issueDatabaseBulkInvitations(input, "bride")).rejects.toThrow("Insert failed");
    expect(mocks.query.mock.calls.map(([query]) => query)).toEqual(["begin", "rollback"]);
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
