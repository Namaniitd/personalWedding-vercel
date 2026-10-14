-- QR entry passes for the authenticated production coordinator surface.
-- Apply after 0001_shaadi_companion.sql and 0002_security_hardening.sql.
--
-- This migration prepares the hosted DBMS model only. A production scanner must
-- validate a named, MFA/AAL2 coordinator session and derive the pass digest
-- server-side with ENTRY_PASS_TOKEN_PEPPER before it is exposed.

do $$
begin
  create type public.entry_pass_status as enum ('active', 'invalidated');
exception
  when duplicate_object then null;
end;
$$;

-- `pass_version` is not secret. A server derives the raw 256-bit QR token from
-- the private invitation bearer token, this UUID, and a separate entry-pass
-- pepper. This allows a confirmed household to reload the same pass without
-- storing a raw QR credential at rest. `token_hash` is an HMAC of that derived
-- token, and is the only value used for lookup during a scan.
create table if not exists public.entry_passes (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.invitations(id) on delete restrict,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  pass_version uuid not null default gen_random_uuid(),
  status public.entry_pass_status not null default 'active',
  invalidated_at timestamptz,
  invalidation_reason text check (invalidation_reason in ('invitation_revoked', 'rsvp_no_longer_attending', 'rsvp_purged', 'operator_rotated')),
  issued_at timestamptz not null default now(),
  constraint entry_passes_invalidation_state_check check (
    (status = 'active' and invalidated_at is null and invalidation_reason is null)
    or (status = 'invalidated' and invalidated_at is not null and invalidation_reason is not null)
  )
);

-- The QR is household-scoped, while admission is event-scoped. A first scan
-- creates exactly one row for the pass/event pair. Repeat scans update only
-- last_scanned_at and scan_count, so a scanner can show a duplicate warning
-- rather than admit the household twice. Count snapshots preserve what was
-- accepted at the gate if a later RSVP edit changes the planning totals.
create table if not exists public.entry_check_ins (
  id uuid primary key default gen_random_uuid(),
  entry_pass_id uuid not null references public.entry_passes(id) on delete restrict,
  event_id uuid not null references public.events(id) on delete restrict,
  expected_adult_count smallint not null check (expected_adult_count between 0 and 30),
  expected_child_count smallint not null check (expected_child_count between 0 and 30),
  checked_in_at timestamptz not null default now(),
  last_scanned_at timestamptz not null default now(),
  checked_in_by uuid references auth.users(id) on delete set null,
  last_scanned_by uuid references auth.users(id) on delete set null,
  scan_count integer not null default 1 check (scan_count >= 1),
  constraint entry_check_ins_expected_guests_check check (expected_adult_count + expected_child_count > 0),
  constraint entry_check_ins_scan_time_check check (last_scanned_at >= checked_in_at),
  constraint entry_check_ins_one_event_per_pass_unique unique (entry_pass_id, event_id)
);

create unique index if not exists entry_passes_one_active_per_invitation_idx
  on public.entry_passes (invitation_id)
  where status = 'active';
create index if not exists entry_check_ins_event_checked_in_idx
  on public.entry_check_ins (event_id, checked_in_at desc);

-- Existing coordinator dashboard policies can update RSVP/attendance rows.
-- Make those direct writes take a shared invitation lock before they change
-- entitlement, matching the gate trigger's invitation UPDATE lock. This keeps
-- the DB-only check-in guard serializable with a direct coordinator edit too.
create or replace function public.lock_invitation_for_entry_pass_rsvp_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_invitation_id uuid;
begin
  v_invitation_id := case when tg_op = 'DELETE' then old.invitation_id else new.invitation_id end;
  perform 1
    from public.invitations
   where id = v_invitation_id
   for share;
  if not found then
    raise exception 'Invitation could not be found' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.lock_invitation_for_entry_pass_attendance_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_rsvp_id uuid;
begin
  v_rsvp_id := case when tg_op = 'DELETE' then old.rsvp_id else new.rsvp_id end;
  perform 1
    from public.rsvps as responses
    join public.invitations as invitations on invitations.id = responses.invitation_id
   where responses.id = v_rsvp_id
   for share of invitations;
  if not found then
    raise exception 'RSVP could not be found' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.lock_invitation_for_entry_pass_rsvp_write() from public, anon, authenticated;
revoke all on function public.lock_invitation_for_entry_pass_attendance_write() from public, anon, authenticated;

drop trigger if exists rsvps_entry_pass_invitation_lock on public.rsvps;
create trigger rsvps_entry_pass_invitation_lock
before insert or update or delete on public.rsvps
for each row execute function public.lock_invitation_for_entry_pass_rsvp_write();

drop trigger if exists attendance_entry_pass_invitation_lock on public.rsvp_event_attendance;
create trigger attendance_entry_pass_invitation_lock
before insert or update or delete on public.rsvp_event_attendance
for each row execute function public.lock_invitation_for_entry_pass_attendance_write();

-- Do not leave a pass usable after an invitation is revoked. The app-level
-- revoke transaction takes the invitation lock first too; this trigger is a
-- second guard for emergency/reviewed direct SQL changes.
create or replace function public.invalidate_entry_passes_for_invitation_revoke()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if old.status <> 'revoked' and new.status = 'revoked' then
    update public.entry_passes
       set status = 'invalidated',
           invalidated_at = coalesce(invalidated_at, now()),
           invalidation_reason = coalesce(invalidation_reason, 'invitation_revoked')
     where invitation_id = new.id
       and status = 'active';
  end if;
  return new;
end;
$$;

-- A declined/confirming RSVP no longer has a valid QR. If an attending RSVP
-- changes selected events while remaining attending, the scanner checks the
-- current per-event attendance below; this permits a single household QR to
-- work correctly across multiple events without recreating it on every edit.
create or replace function public.invalidate_entry_passes_for_rsvp_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_invitation_id uuid;
begin
  if tg_op = 'DELETE' then
    v_invitation_id := old.invitation_id;
  else
    v_invitation_id := new.invitation_id;
  end if;

  if tg_op = 'DELETE' or new.status <> 'attending' then
    update public.entry_passes
       set status = 'invalidated',
           invalidated_at = coalesce(invalidated_at, now()),
           invalidation_reason = coalesce(invalidation_reason, 'rsvp_no_longer_attending')
     where invitation_id = v_invitation_id
       and status = 'active';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Check database state immediately before every first/repeat gate write. This
-- protects the result even if a future scanner route accidentally separates
-- lookup from check-in. The authenticated scanner still performs this same
-- validation in its server route and does not disclose names/counts on failure.
create or replace function public.require_active_entry_pass_for_check_in()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_pass_status public.entry_pass_status;
  v_invitation_status public.invitation_status;
  v_rsvp_status public.rsvp_status;
  v_rsvp_id uuid;
  v_adults smallint;
  v_children smallint;
begin
  select passes.status, invitations.status, responses.status, responses.id
    into v_pass_status, v_invitation_status, v_rsvp_status, v_rsvp_id
    from public.entry_passes as passes
    join public.invitations as invitations on invitations.id = passes.invitation_id
    left join public.rsvps as responses on responses.invitation_id = invitations.id
   where passes.id = new.entry_pass_id
   -- Take a conflicting lock with RSVP/revocation operations. The scanner RPC
   -- uses the same invitation-then-pass order, but this DB guard must remain
   -- race-safe if a reviewed direct SQL update is ever performed.
   for update of passes, invitations;

  if v_pass_status is distinct from 'active'
    or v_invitation_status is distinct from 'active'
    or v_rsvp_status is distinct from 'attending' then
    raise exception 'An entry check-in requires an active attending invitation.'
      using errcode = 'P0001';
  end if;

  select adult_count, child_count into v_adults, v_children
    from public.rsvp_event_attendance
   where rsvp_id = v_rsvp_id
     and event_id = new.event_id
     and is_attending = true;
  if not found then
    raise exception 'The RSVP is not attending this event.' using errcode = 'P0001';
  end if;
  -- The first admission stores a historical count snapshot. A later RSVP edit
  -- must not make the duplicate-scan counter impossible to update, so only a
  -- new first check-in has to exactly match the current RSVP allocation.
  if tg_op = 'INSERT'
    and (new.expected_adult_count <> v_adults or new.expected_child_count <> v_children) then
    raise exception 'Entry count no longer matches the RSVP.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.invalidate_entry_passes_for_invitation_revoke() from public, anon, authenticated;
revoke all on function public.invalidate_entry_passes_for_rsvp_change() from public, anon, authenticated;
revoke all on function public.require_active_entry_pass_for_check_in() from public, anon, authenticated;

drop trigger if exists invitations_invalidate_entry_passes on public.invitations;
create trigger invitations_invalidate_entry_passes
after update of status on public.invitations
for each row execute function public.invalidate_entry_passes_for_invitation_revoke();

drop trigger if exists rsvps_invalidate_entry_passes on public.rsvps;
create trigger rsvps_invalidate_entry_passes
after insert or update or delete on public.rsvps
for each row execute function public.invalidate_entry_passes_for_rsvp_change();

drop trigger if exists entry_check_ins_require_active_pass on public.entry_check_ins;
create trigger entry_check_ins_require_active_pass
before insert or update on public.entry_check_ins
for each row execute function public.require_active_entry_pass_for_check_in();

-- The authenticated scanner cannot impersonate another gate coordinator in a
-- historical record. A server route should use the scanner's verified Supabase
-- JWT when invoking the RPC below; a service-role-only route would lose this
-- actor identity and is not an acceptable production scanner design.
create or replace function public.set_entry_check_in_actor()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if auth.role() = 'authenticated' then
    if tg_op = 'INSERT' then new.checked_in_by := auth.uid(); end if;
    new.last_scanned_by := auth.uid();
  end if;
  return new;
end;
$$;

revoke all on function public.set_entry_check_in_actor() from public, anon, authenticated;

drop trigger if exists entry_check_ins_set_actor on public.entry_check_ins;
create trigger entry_check_ins_set_actor
before insert or update on public.entry_check_ins
for each row execute function public.set_entry_check_in_actor();

-- The raw QR token is HMACed by the server before this call. Gate browsers
-- never read `entry_passes.token_hash`; they receive only this whitelisted
-- result after their MFA/AAL2 role and the current RSVP/event entitlement pass.
create or replace function public.check_in_entry_pass(p_pass_hash text, p_event_id uuid)
returns table (
  outcome text,
  household_name text,
  expected_adult_count smallint,
  expected_child_count smallint,
  checked_in_at timestamptz,
  scan_count integer
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_invitation_id uuid;
  v_pass_id uuid;
  v_rsvp_id uuid;
  v_household_name text;
  v_adults smallint;
  v_children smallint;
  v_check_in public.entry_check_ins%rowtype;
  v_outcome text;
begin
  if not public.has_wedding_role(array['owner', 'hospitality']::public.coordinator_role[]) then
    raise exception 'Coordinator access is required' using errcode = 'P0001';
  end if;
  if coalesce(p_pass_hash, '') !~ '^[0-9a-f]{64}$' or p_event_id is null then
    raise exception 'Entry pass is unavailable' using errcode = 'P0001';
  end if;

  -- Find the subject without a row lock, then use the common invitation-first
  -- lock order. The locked re-read below catches a concurrent invalidation.
  select invitation_id into v_invitation_id
    from public.entry_passes
   where token_hash = p_pass_hash
   limit 1;
  if not found then
    raise exception 'Entry pass is unavailable' using errcode = 'P0001';
  end if;

  select case when preferred_locale = 'hi' then household_name_hi else household_name_en end
    into v_household_name
    from public.invitations
   where id = v_invitation_id
     and status = 'active'
   for update;
  if not found then
    raise exception 'Entry pass is unavailable' using errcode = 'P0001';
  end if;

  select id into v_pass_id
    from public.entry_passes
   where invitation_id = v_invitation_id
     and token_hash = p_pass_hash
     and status = 'active'
   for update;
  if not found then
    raise exception 'Entry pass is unavailable' using errcode = 'P0001';
  end if;

  select id into v_rsvp_id
    from public.rsvps
   where invitation_id = v_invitation_id
     and status = 'attending'
   for share;
  if not found then
    raise exception 'Entry pass is unavailable' using errcode = 'P0001';
  end if;

  select adult_count, child_count into v_adults, v_children
    from public.rsvp_event_attendance
   where rsvp_id = v_rsvp_id
     and event_id = p_event_id
     and is_attending = true;
  if not found then
    raise exception 'This household is not confirmed for the selected celebration.' using errcode = 'P0001';
  end if;

  select * into v_check_in
    from public.entry_check_ins
   where entry_pass_id = v_pass_id
     and event_id = p_event_id
   for update;
  if found then
    update public.entry_check_ins
       set last_scanned_at = now(),
           scan_count = scan_count + 1
     where id = v_check_in.id
     returning * into v_check_in;
    v_outcome := 'already_checked_in';
  else
    insert into public.entry_check_ins (
      entry_pass_id, event_id, expected_adult_count, expected_child_count
    ) values (
      v_pass_id, p_event_id, v_adults, v_children
    ) returning * into v_check_in;
    v_outcome := 'checked_in';
  end if;

  return query select
    v_outcome,
    v_household_name,
    v_adults,
    v_children,
    v_check_in.checked_in_at,
    v_check_in.scan_count;
end;
$$;

revoke all on function public.check_in_entry_pass(text, uuid) from public, anon, authenticated;
grant execute on function public.check_in_entry_pass(text, uuid) to authenticated;

alter table public.entry_passes enable row level security;
alter table public.entry_check_ins enable row level security;
revoke all on table public.entry_passes from anon;
revoke all on table public.entry_check_ins from anon;

-- Gate staff can review the minimal admission ledger but cannot mint, rotate,
-- invalidate, or alter a pass directly. A future server-side scan RPC should
-- run under the scanner's verified authenticated session and use this policy/
-- trigger combination; it must not expose raw token hashes to the browser.
create policy "owners manage entry passes" on public.entry_passes
  for all to authenticated
  using (public.is_wedding_owner())
  with check (public.is_wedding_owner());
create policy "gate staff read entry check-ins" on public.entry_check_ins
  for select to authenticated
  using (public.has_wedding_role(array['owner', 'hospitality']::public.coordinator_role[]));

comment on table public.entry_passes is
  'Production household QR credentials. Stores HMAC digests and non-secret rotation UUIDs only; raw QR and invitation tokens are never persisted.';
comment on table public.entry_check_ins is
  'Production event-gate audit. One row per household pass/event; repeat scans update a counter and do not create a second admission.';
