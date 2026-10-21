import { randomUUID } from "node:crypto";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { handleApiRequest } from "./app.js";
import type { WeddingSide } from "./domain/types.js";
import { issueDatabaseBulkInvitations } from "./lib/database-bulk-invitations.js";
import { resolveDatabaseInvitation } from "./lib/database-invitations.js";
import { resolveDatabasePublicInvitation, submitDatabasePublicRSVP } from "./lib/database-public-rsvps.js";
import { databaseInvitationTokenDigest, getDatabasePool, resetDatabaseRsvpPoolForTest } from "./lib/database-rsvps.js";

function disposableDatabase(value: string | undefined) {
  if (!value) return false;
  const probe = new Client({ connectionString: value }) as Client & {
    connectionParameters: { host: string; port: number; isDomainSocket: boolean };
  };
  return !probe.connectionParameters.isDomainSocket
    && ["127.0.0.1", "::1"].includes(probe.connectionParameters.host)
    && Number(probe.connectionParameters.port) === 54329;
}

const enabled = process.env.RUN_PUBLIC_INVITATION_DATABASE_TESTS === "true"
  && disposableDatabase(process.env.API_TEST_DATABASE_OWNER_URL)
  && disposableDatabase(process.env.DATABASE_URL);

(enabled ? describe : describe.skip)("public RSVP and bulk invitations under the restricted runtime role", () => {
  let owner: Client | undefined;
  let originalCutoff: Date;
  let originalDefaultSelected: boolean;
  let brideCreated = false;
  const suffix = randomUUID();
  const brideEvent = `public-bride-${suffix}`;
  const excludedEvent = `public-excluded-${suffix}`;
  const ids: string[] = [];
  const serviceToken = "public-integration-service-token-abcdefghijklmnopqrstuvwxyz";

  beforeAll(async () => {
    vi.stubEnv("BACKEND_SERVICE_TOKEN", serviceToken);
    for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "INVITATION_TOKEN_PEPPER", "ENTRY_PASS_TOKEN_PEPPER"]) vi.stubEnv(key, "");
    owner = new Client({ connectionString: process.env.API_TEST_DATABASE_OWNER_URL });
    await owner.connect();
    expect((await owner.query("select title_en from wedding.events where id='test-event' and side='groom'")).rows[0]?.title_en).toBe("Test event");
    expect((await owner.query("select 1 from wedding.settings where side='bride'")).rows).toHaveLength(0);
    const settings = (await owner.query("select can_edit_until from wedding.settings where id=1 and side='groom'")).rows[0];
    originalCutoff = settings.can_edit_until;
    originalDefaultSelected = (await owner.query("select default_selected from wedding.events where id='test-event'")).rows[0].default_selected;
    await owner.query("update wedding.events set default_selected=true where id='test-event'");
    await owner.query(`insert into wedding.settings
      select (jsonb_populate_record(null::wedding.settings, to_jsonb(settings) ||
        '{"id":2,"side":"bride","coordinator_name":"Public bride desk"}'::jsonb)).*
      from wedding.settings as settings where id=1`);
    brideCreated = true;
    await owner.query(`insert into wedding.events
      select (jsonb_populate_record(null::wedding.events, to_jsonb(events) ||
        jsonb_build_object('id',$1::text,'side','bride','default_selected',true))).*
      from wedding.events as events where id='test-event'`, [brideEvent]);
    await owner.query(`insert into wedding.events
      select (jsonb_populate_record(null::wedding.events, to_jsonb(events) ||
        jsonb_build_object('id',$1::text,'slug',$1::text,'default_selected',false))).*
      from wedding.events as events where id='test-event'`, [excludedEvent]);
    expect((await getDatabasePool().query("select current_user")).rows[0].current_user).not.toBe((await owner.query("select current_user")).rows[0].current_user);
  });

  afterAll(async () => {
    if (owner) {
      await owner.query("drop trigger if exists test_reject_bulk_invitation on wedding.invitations");
      await owner.query("drop function if exists wedding.test_reject_bulk_invitation()");
      await owner.query("update wedding.invitations set status='revoked',revoked_at=coalesce(revoked_at,now()) where id=any($1::uuid[])", [ids]);
      await owner.query("delete from wedding.rsvps where token_hash in (select token_hash from wedding.invitations where id=any($1::uuid[]))", [ids]);
      await owner.query("delete from wedding.entry_check_ins where entry_pass_id in (select id from wedding.entry_passes where invitation_id=any($1::uuid[]))", [ids]);
      await owner.query("delete from wedding.entry_passes where invitation_id=any($1::uuid[])", [ids]);
      await owner.query("delete from wedding.coordinator_rsvp_audit where invitation_id=any($1::uuid[])", [ids]);
      await owner.query("delete from wedding.invitations where id=any($1::uuid[])", [ids]);
      await owner.query("delete from wedding.events where id=any($1::text[])", [[brideEvent, excludedEvent]]);
      if (brideCreated) {
        await owner.query("delete from wedding.contacts where side='bride'");
        await owner.query("delete from wedding.settings where id=2 and side='bride'");
      }
      if (originalCutoff) await owner.query("update wedding.settings set can_edit_until=$1 where id=1", [originalCutoff]);
      if (originalDefaultSelected !== undefined) await owner.query("update wedding.events set default_selected=$1 where id='test-event'", [originalDefaultSelected]);
      await owner.end();
    }
    await resetDatabaseRsvpPoolForTest();
    vi.unstubAllEnvs();
  });

  async function track(token: string) {
    const row = (await owner!.query("select id from wedding.invitations where token_hash=$1", [databaseInvitationTokenDigest(token)])).rows[0];
    expect(row?.id).toBeTruthy();
    ids.push(row.id);
  }

  async function countInvitations() {
    return Number((await owner!.query("select count(*) from wedding.invitations")).rows[0].count);
  }

  function request(path: string, body: unknown, side: WeddingSide = "groom") {
    return new Request(`http://api.internal${path}`, {
      method: "POST", headers: { "X-Backend-Service-Token": serviceToken, "X-Wedding-Side": side, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  function guest(side: WeddingSide, respondentName = "Public synthetic guest") {
    return {
      side, respondentName, contactNumber: "+1 (202) 555-0101", status: "attending" as const,
      attendances: [{ eventId: side === "groom" ? "test-event" : brideEvent, attending: true, adults: 1, children: 0 }]
    };
  }

  it("returns only each side's default events and never exposes private household details", async () => {
    for (const side of ["groom", "bride"] as const) {
      const response = await handleApiRequest(request("/v1/public/invitations/resolve", { side }));
      expect(response.status).toBe(200);
      const { resolved } = await response.json();
      expect(resolved.invitation.kind).toBe("public");
      expect(resolved.invitation.side).toBe(side);
      expect(resolved.invitation.token).toBe(`public-invitation-${side}`);
      expect(resolved.events.map((event: { id: string }) => event.id)).toEqual([side === "groom" ? "test-event" : brideEvent]);
      expect(resolved.invitation).not.toHaveProperty("contactNumber");
      expect(resolved.rsvp).toBeNull();
      expect(resolved).not.toHaveProperty("entryPass");
      expect(await resolveDatabaseInvitation(resolved.invitation.token)).toBeNull();
    }
  });

  it("gives repeated contacts independent private responses and edit links on both sides", async () => {
    const first = await submitDatabasePublicRSVP(guest("groom", "First public fixture"));
    await track(first.token);
    const second = await submitDatabasePublicRSVP(guest("groom", "Second public fixture"));
    await track(second.token);
    const bride = await submitDatabasePublicRSVP(guest("bride", "Bride public fixture"));
    await track(bride.token);
    expect(new Set([first.token, second.token, bride.token]).size).toBe(3);
    for (const [saved, side, name] of [[first, "groom", "First public fixture"], [second, "groom", "Second public fixture"], [bride, "bride", "Bride public fixture"]] as const) {
      const resolved = await resolveDatabaseInvitation(saved.token, side);
      expect(resolved?.invitation.contactNumber).toBe(guest(side).contactNumber);
      expect(resolved?.rsvp?.contactNumber).toBe(guest(side).contactNumber);
      expect(resolved?.rsvp?.respondentName).toBe(name);
      expect(resolved?.entryPass).toBeTruthy();
      expect(saved.resolved.rsvp).toEqual(resolved?.rsvp);
      expect(await resolveDatabaseInvitation(saved.token, side === "groom" ? "bride" : "groom")).toBeNull();
    }
    const publicTemplate = await resolveDatabasePublicInvitation("groom");
    expect(JSON.stringify(publicTemplate)).not.toContain("First public fixture");
    expect(publicTemplate.rsvp).toBeNull();
  });

  it("rejects invalid selections, missing contacts and closed RSVP windows without orphan invitations", async () => {
    const before = await countInvitations();
    const invalid = await handleApiRequest(request("/v1/public/rsvp", {
      ...guest("groom"), attendances: [{ eventId: excludedEvent, attending: true, adults: 1, children: 0 }]
    }));
    expect(invalid.status).toBe(422);
    expect((await handleApiRequest(request("/v1/public/rsvp", { ...guest("groom"), contactNumber: "" }))).status).toBe(400);
    await owner!.query("update wedding.settings set can_edit_until=clock_timestamp()-interval '1 minute' where id=1");
    try {
      expect((await handleApiRequest(request("/v1/public/rsvp", guest("groom")))).status).toBe(422);
    } finally {
      await owner!.query("update wedding.settings set can_edit_until=$1 where id=1", [originalCutoff]);
    }
    expect(await countInvitations()).toBe(before);
  });

  it("creates a complete bulk import with names, contacts and the chosen limits", async () => {
    const response = await handleApiRequest(request("/v1/coordinator/invitations/bulk", {
      csv: "contactnumber,name\n+12025550102,Bulk first fixture\n+12025550103,Bulk second fixture",
      preferredLocale: "hi", eventLimits: [{ eventId: brideEvent, adults: 3, children: 2 }]
    }, "bride"));
    expect(response.status).toBe(200);
    const { issued } = await response.json();
    ids.push(...issued.map((row: { id: string }) => row.id));
    expect(issued).toHaveLength(2);
    for (const [index, row] of issued.entries()) {
      expect(row.side).toBe("bride");
      expect(row.contactRole).toBe("bride");
      expect(row.contactNumber).toBe(`+1202555010${index + 2}`);
      expect(row.householdName.en).toBe(index ? "Bulk second fixture" : "Bulk first fixture");
      expect(row.householdName.hi).toBe(row.householdName.en);
      const resolved = await resolveDatabaseInvitation(row.token, "bride");
      expect(resolved?.invitation.preferredLocale).toBe("hi");
      expect(resolved?.invitation.eventLimits).toEqual({ [brideEvent]: { adults: 3, children: 2 } });
      expect(resolved?.rsvp).toBeNull();
    }
  });

  it("rolls back every bulk row after an insertion failure and rejects duplicate contacts", async () => {
    const before = await countInvitations();
    await owner!.query(`create function wedding.test_reject_bulk_invitation() returns trigger language plpgsql as $$
      begin
        if new.household_name_en='Reject bulk fixture' then raise exception 'Synthetic bulk failure.'; end if;
        return new;
      end $$`);
    await owner!.query("create trigger test_reject_bulk_invitation before insert on wedding.invitations for each row execute function wedding.test_reject_bulk_invitation()");
    try {
      await expect(issueDatabaseBulkInvitations({
        csv: "name,contactnumber\nBulk rollback fixture,+12025550104\nReject bulk fixture,+12025550105",
        preferredLocale: "en", contactRole: "groom", eventLimits: [{ eventId: "test-event", adults: 2, children: 0 }]
      }, "groom")).rejects.toThrow("Synthetic bulk failure");
    } finally {
      await owner!.query("drop trigger test_reject_bulk_invitation on wedding.invitations");
      await owner!.query("drop function wedding.test_reject_bulk_invitation()");
    }
    const duplicate = await handleApiRequest(request("/v1/coordinator/invitations/bulk", {
      csv: "name,contactnumber\nFirst fixture,+1 202 555 0104\nSecond fixture,1(202)555-0104",
      eventLimits: [{ eventId: "test-event", adults: 2, children: 0 }]
    }));
    expect(duplicate.status).toBe(422);
    expect(await duplicate.text()).toContain("row 2");
    expect(await countInvitations()).toBe(before);
  });
});
