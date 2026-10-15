import { createHash, randomUUID } from "node:crypto";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { handleApiRequest } from "./app.js";
import { parseEntryPassPayload } from "./domain/entry-pass.js";
import type { DatabaseWeddingContentSnapshot, WeddingSide } from "./domain/types.js";
import { manageDatabaseCoordinatorSession } from "./lib/database-coordinator-sessions.js";
import {
  checkInDatabaseEntryPass, deleteDatabaseRSVPForRevokedInvitation, issueDatabaseInvitation,
  listDatabaseCoordinatorInvitations, resolveDatabaseInvitation, revokeDatabaseInvitation
} from "./lib/database-invitations.js";
import { saveDatabaseCoordinatorRSVP } from "./lib/database-coordinator-rsvps.js";
import { DatabaseRsvpClosedError, resetDatabaseRsvpPoolForTest, saveDatabaseRSVP } from "./lib/database-rsvps.js";
import {
  databaseWeddingContentEditorSchema, loadDatabaseWeddingContentEditor, saveDatabaseWeddingContentEditor
} from "./lib/database-wedding-content-editor.js";

function disposableDatabase(value: string | undefined) {
  if (!value) return false;
  const probe = new Client({ connectionString: value }) as Client & {
    connectionParameters: { host: string; port: number; isDomainSocket: boolean };
  };
  return !probe.connectionParameters.isDomainSocket
    && ["127.0.0.1", "::1"].includes(probe.connectionParameters.host)
    && Number(probe.connectionParameters.port) === 54329;
}

const enabled = process.env.RUN_WEDDING_SIDE_DATABASE_TESTS === "true"
  && disposableDatabase(process.env.API_TEST_DATABASE_OWNER_URL)
  && disposableDatabase(process.env.DATABASE_URL);

function editorInput(snapshot: DatabaseWeddingContentSnapshot) {
  const { side: _side, ...input } = snapshot;
  return databaseWeddingContentEditorSchema.parse(input);
}

(enabled ? describe : describe.skip)("private wedding sides under the restricted runtime role", () => {
  let owner: Client | undefined;
  let originalCutoff: Date;
  let groomEvent: string;
  const brideEvent = `b-isolation-${randomUUID()}`;
  const invitations: Array<Awaited<ReturnType<typeof issueDatabaseInvitation>>> = [];
  const sessionHashes: string[] = [];
  const serviceToken = "side-integration-service-token-abcdefghijklmnopqrstuvwxyz";

  beforeAll(async () => {
    vi.stubEnv("BACKEND_SERVICE_TOKEN", serviceToken);
    for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "INVITATION_TOKEN_PEPPER", "ENTRY_PASS_TOKEN_PEPPER"]) vi.stubEnv(key, "");
    owner = new Client({ connectionString: process.env.API_TEST_DATABASE_OWNER_URL });
    await owner.connect();
    expect((await owner.query("select 1 from wedding.events where id='test-event' and side='groom'")).rows).toHaveLength(1);
    const groom = await loadDatabaseWeddingContentEditor("groom");
    const bride = await loadDatabaseWeddingContentEditor("bride");
    expect(bride.revision).toBeNull();
    expect(bride.events).toEqual([]);
    originalCutoff = (await owner.query("select can_edit_until from wedding.settings where id=1 and side='groom'")).rows[0].can_edit_until;
    groomEvent = groom.events[0].id;
    const input = editorInput(groom);
    const saved = await saveDatabaseWeddingContentEditor({
      ...input, revision: null,
      settings: { ...input.settings, coupleNamesEn: "Bride isolation fixture", coupleNamesHi: "दुल्हन परीक्षण युगल", coordinatorName: "Bride fixture desk" },
      events: [{ ...input.events[0], id: brideEvent }],
      contacts: [{ role: "bride", name: "Bride fixture desk", phone: "+919876543211", isActive: true }]
    }, "bride");
    expect(saved.kind).toBe("saved");
    invitations.push(await issueDatabaseInvitation({ householdNameEn: "Groom fixture household", preferredLocale: "en", contactRole: "groom", eventLimits: [{ eventId: groomEvent, adults: 2, children: 0 }] }, "groom"));
    invitations.push(await issueDatabaseInvitation({ householdNameEn: "Bride fixture household", preferredLocale: "hi", contactRole: "bride", eventLimits: [{ eventId: brideEvent, adults: 2, children: 0 }] }, "bride"));
  });

  afterAll(async () => {
    if (owner) {
      if (originalCutoff) await owner.query("update wedding.settings set can_edit_until=$1 where id=1 and side='groom'", [originalCutoff]);
      const ids = invitations.map((invitation) => invitation.id);
      await owner.query("update wedding.invitations set status='revoked', revoked_at=coalesce(revoked_at,now()) where id=any($1::uuid[])", [ids]);
      await owner.query("delete from wedding.rsvps where token_hash in (select token_hash from wedding.invitations where id=any($1::uuid[]))", [ids]);
      await owner.query("delete from wedding.entry_check_ins where entry_pass_id in (select id from wedding.entry_passes where invitation_id=any($1::uuid[]))", [ids]);
      await owner.query("delete from wedding.entry_passes where invitation_id=any($1::uuid[])", [ids]);
      await owner.query("delete from wedding.coordinator_rsvp_audit where invitation_id=any($1::uuid[])", [ids]);
      await owner.query("delete from wedding.invitations where id=any($1::uuid[])", [ids]);
      await owner.query("delete from wedding.events where id=$1 and side='bride'", [brideEvent]);
      await owner.query("delete from wedding.contacts where side='bride'");
      await owner.query("delete from wedding.settings where id=2 and side='bride'");
      await owner.query("delete from wedding.coordinator_sessions where session_hash=any($1::text[])", [sessionHashes]);
      await resetDatabaseRsvpPoolForTest();
      await owner.end();
    }
    vi.unstubAllEnvs();
  });

  function guest(index: number) {
    return {
      token: invitations[index].token, respondentName: index === 0 ? "Groom fixture guest" : "Bride fixture guest",
      status: "attending" as const,
      attendances: [{ eventId: index === 0 ? groomEvent : brideEvent, attending: true, adults: 2, children: 0 }]
    };
  }

  function request(path: string, side: WeddingSide, body?: unknown) {
    return new Request(`http://api.internal${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "X-Backend-Service-Token": serviceToken, "X-Wedding-Side": side, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  }

  it("preserves legacy bearer URLs and resolves only the stored owner's content", async () => {
    for (const [index, side] of [[0, "groom"], [1, "bride"]] as const) {
      const legacy = await resolveDatabaseInvitation(invitations[index].token);
      expect(legacy?.invitation.side).toBe(side);
      expect(legacy?.events.map((event) => event.id)).toEqual([index === 0 ? groomEvent : brideEvent]);
      expect(await resolveDatabaseInvitation(invitations[index].token, side === "groom" ? "bride" : "groom")).toBeNull();
      const mismatched = await handleApiRequest(request("/v1/invitations/resolve", side, { token: invitations[index].token, side: side === "groom" ? "bride" : "groom" }));
      expect(mismatched.status).toBe(404);
    }
    expect((await resolveDatabaseInvitation(invitations[1].token))?.wedding.couple.en).toBe("Bride isolation fixture");
    expect((await resolveDatabaseInvitation(invitations[0].token))?.wedding.couple.en).not.toBe("Bride isolation fixture");
  });

  it("blocks every cross-side coordinator identifier mutation without exposing the foreign household", async () => {
    const saved = await saveDatabaseRSVP(guest(0));
    const passToken = parseEntryPassPayload(saved.entryPass!.qrPayload)!;
    const foreignId = invitations[0].id;
    expect(await revokeDatabaseInvitation(foreignId, "bride")).toBeNull();
    expect(await deleteDatabaseRSVPForRevokedInvitation(foreignId, "bride")).toEqual({ kind: "not_found" });
    const { token: _token, ...details } = guest(0);
    expect(await saveDatabaseCoordinatorRSVP({ ...details, invitationId: foreignId, expectedUpdatedAt: saved.record.updatedAt }, "bride")).toEqual({ kind: "not_found" });
    expect(await checkInDatabaseEntryPass({ passToken, eventId: brideEvent }, "bride")).toEqual({ kind: "not_found" });
    for (const [path, body] of [
      ["/v1/coordinator/invitations/revoke", { invitationId: foreignId }],
      ["/v1/coordinator/invitations/rsvp/delete", { invitationId: foreignId }],
      ["/v1/coordinator/rsvp", { ...details, invitationId: foreignId, expectedUpdatedAt: saved.record.updatedAt }],
      ["/v1/coordinator/check-in", { passToken, eventId: brideEvent }]
    ] as const) {
      const response = await handleApiRequest(request(path, "bride", body));
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("Groom fixture");
    }
    const groom = await resolveDatabaseInvitation(invitations[0].token);
    expect(groom?.rsvp?.updatedAt).toBe(saved.record.updatedAt);
    expect(groom?.entryPass?.qrPayload).toBe(saved.entryPass!.qrPayload);
    expect((await listDatabaseCoordinatorInvitations("bride")).some((entry) => entry.id === foreignId)).toBe(false);
    expect((await listDatabaseCoordinatorInvitations("groom")).some((entry) => entry.id === invitations[1].id)).toBe(false);
  });

  it("keeps content revisions, event slugs and event identifier collisions private to their owner", async () => {
    const beforeGroom = await loadDatabaseWeddingContentEditor("groom");
    const beforeBride = await loadDatabaseWeddingContentEditor("bride");
    expect(beforeBride.events[0].slug).toBe(beforeGroom.events[0].slug);
    const edited = editorInput(beforeBride);
    edited.settings.coordinatorName = "Updated bride fixture desk";
    expect((await saveDatabaseWeddingContentEditor(edited, "bride")).kind).toBe("saved");
    expect(await loadDatabaseWeddingContentEditor("groom")).toEqual(beforeGroom);
    const currentBride = await loadDatabaseWeddingContentEditor("bride");
    const collision = editorInput(currentBride);
    collision.events.push({ ...beforeGroom.events[0], slug: "isolated-collision" });
    expect(await saveDatabaseWeddingContentEditor(collision, "bride")).toEqual({ kind: "event_side_conflict" });
    expect(await loadDatabaseWeddingContentEditor("bride")).toEqual(currentBride);
    expect(await loadDatabaseWeddingContentEditor("groom")).toEqual(beforeGroom);
    await expect(issueDatabaseInvitation({ householdNameEn: "Foreign event fixture", preferredLocale: "en", contactRole: "bride", eventLimits: [{ eventId: groomEvent, adults: 1, children: 0 }] }, "bride")).rejects.toThrow("not available");
  });

  it("derives each guest's RSVP cutoff from their token owner", async () => {
    await owner!.query("update wedding.settings set can_edit_until=clock_timestamp()-interval '1 minute' where id=1 and side='groom'");
    try {
      await expect(saveDatabaseRSVP(guest(0))).rejects.toBeInstanceOf(DatabaseRsvpClosedError);
      const bride = await saveDatabaseRSVP(guest(1));
      expect(bride.entryPass).not.toBeNull();
      expect((await resolveDatabaseInvitation(invitations[1].token))?.rsvp?.updatedAt).toBe(bride.record.updatedAt);
    } finally {
      await owner!.query("update wedding.settings set can_edit_until=$1 where id=1 and side='groom'", [originalCutoff]);
    }
  });

  it("binds durable registration, validation and logout to the side", async () => {
    const sessionHash = createHash("sha256").update(randomUUID()).digest("hex");
    sessionHashes.push(sessionHash);
    const registration = { action: "register" as const, sessionHash, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), side: "bride" as const };
    expect(await manageDatabaseCoordinatorSession(registration)).toBe(true);
    expect(await manageDatabaseCoordinatorSession({ action: "validate", sessionHash, side: "groom" })).toBe(false);
    await manageDatabaseCoordinatorSession({ action: "revoke", sessionHash, side: "groom" });
    expect(await manageDatabaseCoordinatorSession({ action: "validate", sessionHash, side: "bride" })).toBe(true);
    expect(await manageDatabaseCoordinatorSession({ ...registration, side: "groom" })).toBe(false);
    await manageDatabaseCoordinatorSession({ action: "revoke", sessionHash, side: "bride" });
    expect(await manageDatabaseCoordinatorSession({ action: "validate", sessionHash, side: "bride" })).toBe(false);
  });
});
