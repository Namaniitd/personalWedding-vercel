import { parse } from "csv-parse/sync";
import { z } from "zod";

import { contactNumberSchema } from "../domain/rsvp.js";
import type { WeddingSide } from "../domain/types.js";
import { lockDatabaseContentAndInvitationIssue } from "./database-content-lock.js";
import {
  databaseInvitationIssueSchema,
  issueDatabaseInvitationInTransaction,
  validateDatabaseInvitationContactRoleForConfiguration,
  validateDatabaseInvitationIssueForConfiguration
} from "./database-invitations.js";
import { getDatabasePool } from "./database-rsvps.js";
import { loadDatabaseWeddingConfiguration } from "./database-wedding-content.js";

export const MAX_BULK_INVITATIONS = 200;
export const MAX_BULK_CSV_BYTES = 256 * 1024;

export const bulkInvitationIssueSchema = z.object({
  csv: z.string().min(1).max(MAX_BULK_CSV_BYTES),
  preferredLocale: z.enum(["en", "hi"]).default("en"),
  contactRole: z.enum(["groom", "bride"]).default("groom"),
  eventLimits: z.array(z.object({
    eventId: z.string().min(1).max(100),
    adults: z.number().int().min(0).max(30),
    children: z.number().int().min(0).max(30)
  }).strict()).min(1).max(12)
}).strict();

export class BulkInvitationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BulkInvitationValidationError";
  }
}

/** Parse and validate the whole file before any invitation is created. */
export function parseBulkInvitationCsv(csv: string) {
  if (Buffer.byteLength(csv, "utf8") > MAX_BULK_CSV_BYTES) {
    throw new BulkInvitationValidationError("The CSV must be 256 KiB or smaller.");
  }
  let rows: string[][];
  try {
    rows = parse(csv, {
      bom: true,
      trim: true,
      skip_empty_lines: true,
      max_record_size: MAX_BULK_CSV_BYTES
    }) as string[][];
  } catch (error) {
    const line = typeof error === "object" && error !== null && "lines" in error && typeof error.lines === "number"
      ? ` at row ${error.lines}` : "";
    throw new BulkInvitationValidationError(`The CSV is invalid${line}. Check quoted fields and ensure every row has name and contactnumber.`);
  }
  const headers = rows.shift()?.map((header) => header.toLowerCase().replace(/[\s_-]/g, ""));
  if (!headers || headers.length !== 2 || new Set(headers).size !== 2 || !headers.includes("name") || !headers.includes("contactnumber")) {
    throw new BulkInvitationValidationError("The CSV header must contain name and contactnumber.");
  }
  if (!rows.length) throw new BulkInvitationValidationError("The CSV must contain at least one guest.");
  if (rows.length > MAX_BULK_INVITATIONS) throw new BulkInvitationValidationError("Upload at most 200 guests at a time.");

  const nameIndex = headers.indexOf("name");
  const contactIndex = headers.indexOf("contactnumber");
  const seen = new Map<string, number>();
  return rows.map((row, index) => {
    const rowNumber = index + 2;
    const name = z.string().trim().min(2).max(100).safeParse(row[nameIndex]);
    if (!name.success) throw new BulkInvitationValidationError(`Row ${rowNumber}: enter a name between 2 and 100 characters.`);
    const contact = contactNumberSchema.refine((value) => value.length > 0).safeParse(row[contactIndex]);
    if (!contact.success) throw new BulkInvitationValidationError(`Row ${rowNumber}: enter a valid contact number.`);
    const duplicateKey = contact.data.replace(/\D/g, "");
    const previousRow = seen.get(duplicateKey);
    if (previousRow) throw new BulkInvitationValidationError(`Row ${rowNumber}: the contact number is already used in row ${previousRow}.`);
    seen.set(duplicateKey, rowNumber);
    return { name: name.data, contactNumber: contact.data, rowNumber };
  });
}

/** The transaction also protects against partial imports and content edits. */
export async function issueDatabaseBulkInvitations(input: z.output<typeof bulkInvitationIssueSchema>, side: WeddingSide) {
  const parsed = bulkInvitationIssueSchema.parse(input);
  const guests = parseBulkInvitationCsv(parsed.csv);
  const client = await getDatabasePool().connect();
  let transactionOpen = false;
  try {
    await client.query("begin");
    transactionOpen = true;
    await lockDatabaseContentAndInvitationIssue(client, side);
    const configuration = await loadDatabaseWeddingConfiguration(client, side);
    const contactValidation = validateDatabaseInvitationContactRoleForConfiguration(parsed.contactRole, configuration);
    if (!contactValidation.ok) throw new BulkInvitationValidationError(contactValidation.message);

    const values = guests.map((guest) => {
      const value = databaseInvitationIssueSchema.parse({
        householdNameEn: guest.name,
        contactNumber: guest.contactNumber,
        preferredLocale: parsed.preferredLocale,
        contactRole: parsed.contactRole,
        eventLimits: parsed.eventLimits
      });
      const validation = validateDatabaseInvitationIssueForConfiguration(value, configuration);
      if (!validation.ok) throw new BulkInvitationValidationError(`Row ${guest.rowNumber}: ${validation.message}`);
      return validation.value;
    });
    const issued = [];
    for (const value of values) {
      issued.push(await issueDatabaseInvitationInTransaction(client, value, side, configuration));
    }
    await client.query("commit");
    transactionOpen = false;
    return issued;
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("rollback");
      } catch {
        // Preserve the original error for the route's safe response.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}
