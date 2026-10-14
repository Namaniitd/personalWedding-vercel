-- Shaadi Companion: private invitation + RSVP data model
-- Apply this migration in a hosted Supabase project before setting production env vars.

create extension if not exists pgcrypto;

create type public.invitation_status as enum ('draft', 'active', 'revoked');
create type public.rsvp_status as enum ('attending', 'declined', 'confirming');
create type public.event_category as enum ('celebration', 'ceremony', 'reception');
create type public.coordinator_role as enum ('owner', 'rsvp', 'hospitality', 'content');

create table public.wedding_settings (
  id smallint primary key default 1 check (id = 1),
  couple_names_en text not null,
  couple_names_hi text not null,
  wedding_date_en text not null,
  wedding_date_hi text not null,
  location_en text not null,
  location_hi text not null,
  wedding_moment timestamptz not null,
  coordinator_name text not null,
  coordinator_phone text not null,
  announcement_en text,
  announcement_hi text,
  announcement_starts_at timestamptz,
  announcement_ends_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  title_en text not null,
  title_hi text not null,
  date_en text not null,
  date_hi text not null,
  start_time_en text not null,
  start_time_hi text not null,
  arrival_window_en text not null,
  arrival_window_hi text not null,
  start_at timestamptz not null,
  end_at timestamptz not null check (end_at > start_at),
  venue_en text not null,
  venue_hi text not null,
  address_en text not null,
  address_hi text not null,
  maps_url text not null check (maps_url ~ '^https://'),
  entry_note_en text not null,
  entry_note_hi text not null,
  dress_code_en text not null,
  dress_code_hi text not null,
  practical_note_en text not null,
  practical_note_hi text not null,
  category public.event_category not null default 'celebration',
  published boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  -- Stable private key used by the import script to de-duplicate a household.
  external_key text not null unique check (char_length(external_key) between 1 and 120),
  -- Store only an HMAC-SHA-256 digest of the 32-byte token, never the raw token.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status public.invitation_status not null default 'draft',
  household_name_en text not null,
  household_name_hi text not null,
  preferred_locale text not null default 'en' check (preferred_locale in ('en', 'hi')),
  -- Internal-only contact; never return it from an invitation page.
  primary_contact_phone text,
  family_side text,
  city text,
  is_outstation boolean not null default false,
  tags text[] not null default '{}',
  rsvp_deadline timestamptz not null,
  can_edit_until timestamptz not null,
  -- Guest bearer links stop resolving after this time even if not manually revoked.
  access_expires_at timestamptz not null,
  sent_at timestamptz,
  last_reminded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (can_edit_until <= rsvp_deadline),
  check (access_expires_at >= rsvp_deadline)
);

create table public.invitation_events (
  invitation_id uuid not null references public.invitations(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  adult_limit smallint not null check (adult_limit >= 0 and adult_limit <= 30),
  child_limit smallint not null check (child_limit >= 0 and child_limit <= 30),
  constraint invitation_events_positive_guest_limit_check
    check (adult_limit + child_limit > 0),
  primary key (invitation_id, event_id)
);

create table public.rsvps (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null unique references public.invitations(id) on delete restrict,
  respondent_name text not null check (char_length(respondent_name) between 2 and 100),
  status public.rsvp_status not null,
  comfort_note text check (char_length(comfort_note) <= 500),
  decline_message text
    constraint rsvps_decline_message_length_check check (char_length(decline_message) <= 500)
    constraint rsvps_decline_message_status_check check (status = 'declined' or decline_message is null),
  coordinator_confirmed boolean not null default false,
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.rsvp_event_attendance (
  rsvp_id uuid not null references public.rsvps(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete restrict,
  is_attending boolean not null default false,
  adult_count smallint not null default 0 check (adult_count between 0 and 30),
  child_count smallint not null default 0 check (child_count between 0 and 30),
  primary key (rsvp_id, event_id),
  check ((is_attending and adult_count + child_count > 0) or (not is_attending and adult_count = 0 and child_count = 0))
);

create table public.logistics_requests (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.invitations(id) on delete restrict,
  arrival_at timestamptz,
  departure_at timestamptz,
  arrival_reference text check (char_length(arrival_reference) <= 160),
  travellers smallint check (travellers between 0 and 30),
  pickup_needed boolean not null default false,
  drop_needed boolean not null default false,
  stay_nights smallint check (stay_nights between 0 and 30),
  request_status text not null default 'requested' check (request_status in ('requested', 'reviewing', 'confirmed', 'not_available')),
  coordinator_note text check (char_length(coordinator_note) <= 500),
  updated_at timestamptz not null default now()
);

create table public.rsvp_revisions (
  id uuid primary key default gen_random_uuid(),
  rsvp_id uuid not null references public.rsvps(id) on delete restrict,
  source text not null check (source in ('guest', 'coordinator')),
  changed_by uuid references auth.users(id),
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table public.coordinator_activity (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid references public.invitations(id) on delete restrict,
  actor_id uuid references auth.users(id),
  action text not null check (char_length(action) between 1 and 80),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now()
);

create table public.admin_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.coordinator_role not null,
  created_at timestamptz not null default now()
);

create index invitations_follow_up_idx on public.invitations (status, rsvp_deadline, sent_at);
create index invitations_tags_idx on public.invitations using gin (tags);
create index attendance_event_idx on public.rsvp_event_attendance (event_id, is_attending);
create index activity_invitation_idx on public.coordinator_activity (invitation_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger wedding_settings_updated_at before update on public.wedding_settings for each row execute function public.set_updated_at();
create trigger events_updated_at before update on public.events for each row execute function public.set_updated_at();
create trigger invitations_updated_at before update on public.invitations for each row execute function public.set_updated_at();
create trigger rsvps_updated_at before update on public.rsvps for each row execute function public.set_updated_at();
create trigger logistics_requests_updated_at before update on public.logistics_requests for each row execute function public.set_updated_at();

-- Named admins can use the dashboard through authenticated Supabase requests. There
-- are deliberately no anonymous table policies; personalized invite access goes only
-- through the server route using the service-role key.
-- Public is not a trusted schema for SECURITY DEFINER functions.
revoke create on schema public from public, anon, authenticated;
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke execute on functions from public;

create or replace function public.has_wedding_role(p_roles public.coordinator_role[])
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and exists (
      select 1
      from public.admin_roles
      where user_id = auth.uid() and role = any(p_roles)
    );
$$;

revoke all on function public.has_wedding_role(public.coordinator_role[]) from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
grant execute on function public.has_wedding_role(public.coordinator_role[]) to authenticated;

create or replace function public.is_wedding_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select public.has_wedding_role(array['owner', 'rsvp', 'hospitality', 'content']::public.coordinator_role[]);
$$;

revoke all on function public.is_wedding_admin() from public, anon, authenticated;
grant execute on function public.is_wedding_admin() to authenticated;

create or replace function public.is_wedding_owner()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select public.has_wedding_role(array['owner']::public.coordinator_role[]);
$$;

revoke all on function public.is_wedding_owner() from public, anon, authenticated;
grant execute on function public.is_wedding_owner() to authenticated;

alter table public.wedding_settings enable row level security;
alter table public.events enable row level security;
alter table public.invitations enable row level security;
alter table public.invitation_events enable row level security;
alter table public.rsvps enable row level security;
alter table public.rsvp_event_attendance enable row level security;
alter table public.logistics_requests enable row level security;
alter table public.rsvp_revisions enable row level security;
alter table public.coordinator_activity enable row level security;
alter table public.admin_roles enable row level security;

-- MFA-backed least privilege. The owner handles invitation issuance/revocation;
-- RSVP, hospitality, and content accounts only see or change what they need.
create policy "coordinators read settings" on public.wedding_settings for select to authenticated using (public.is_wedding_admin());
create policy "owners and content add settings" on public.wedding_settings for insert to authenticated with check (public.has_wedding_role(array['owner', 'content']::public.coordinator_role[]));
create policy "owners and content update settings" on public.wedding_settings for update to authenticated using (public.has_wedding_role(array['owner', 'content']::public.coordinator_role[])) with check (public.has_wedding_role(array['owner', 'content']::public.coordinator_role[]));

create policy "coordinators read events" on public.events for select to authenticated using (public.is_wedding_admin());
create policy "owners and content add events" on public.events for insert to authenticated with check (public.has_wedding_role(array['owner', 'content']::public.coordinator_role[]));
create policy "owners and content update events" on public.events for update to authenticated using (public.has_wedding_role(array['owner', 'content']::public.coordinator_role[])) with check (public.has_wedding_role(array['owner', 'content']::public.coordinator_role[]));

create policy "owners manage invitations" on public.invitations for select to authenticated using (public.has_wedding_role(array['owner']::public.coordinator_role[]));
create policy "rsvp team reads invitations" on public.invitations for select to authenticated using (public.has_wedding_role(array['owner', 'rsvp']::public.coordinator_role[]));
create policy "owners add invitations" on public.invitations for insert to authenticated with check (public.has_wedding_role(array['owner']::public.coordinator_role[]));
create policy "owners update invitations" on public.invitations for update to authenticated using (public.has_wedding_role(array['owner']::public.coordinator_role[])) with check (public.has_wedding_role(array['owner']::public.coordinator_role[]));

create policy "owners read invitation events" on public.invitation_events for select to authenticated using (public.has_wedding_role(array['owner']::public.coordinator_role[]));
create policy "rsvp team reads invitation events" on public.invitation_events for select to authenticated using (public.has_wedding_role(array['owner', 'rsvp']::public.coordinator_role[]));
create policy "owners add invitation events" on public.invitation_events for insert to authenticated with check (public.has_wedding_role(array['owner']::public.coordinator_role[]));
create policy "owners update invitation events" on public.invitation_events for update to authenticated using (public.has_wedding_role(array['owner']::public.coordinator_role[])) with check (public.has_wedding_role(array['owner']::public.coordinator_role[]));

create policy "rsvp team reads rsvps" on public.rsvps for select to authenticated using (public.has_wedding_role(array['owner', 'rsvp']::public.coordinator_role[]));
create policy "rsvp team adds rsvps" on public.rsvps for insert to authenticated with check (public.has_wedding_role(array['owner', 'rsvp']::public.coordinator_role[]));
create policy "rsvp team updates rsvps" on public.rsvps for update to authenticated using (public.has_wedding_role(array['owner', 'rsvp']::public.coordinator_role[])) with check (public.has_wedding_role(array['owner', 'rsvp']::public.coordinator_role[]));

create policy "rsvp team reads attendance" on public.rsvp_event_attendance for select to authenticated using (public.has_wedding_role(array['owner', 'rsvp']::public.coordinator_role[]));
create policy "rsvp team adds attendance" on public.rsvp_event_attendance for insert to authenticated with check (public.has_wedding_role(array['owner', 'rsvp']::public.coordinator_role[]));
create policy "rsvp team updates attendance" on public.rsvp_event_attendance for update to authenticated using (public.has_wedding_role(array['owner', 'rsvp']::public.coordinator_role[])) with check (public.has_wedding_role(array['owner', 'rsvp']::public.coordinator_role[]));

create policy "hospitality team reads logistics" on public.logistics_requests for select to authenticated using (public.has_wedding_role(array['owner', 'hospitality']::public.coordinator_role[]));
create policy "hospitality team adds logistics" on public.logistics_requests for insert to authenticated with check (public.has_wedding_role(array['owner', 'hospitality']::public.coordinator_role[]));
create policy "hospitality team updates logistics" on public.logistics_requests for update to authenticated using (public.has_wedding_role(array['owner', 'hospitality']::public.coordinator_role[])) with check (public.has_wedding_role(array['owner', 'hospitality']::public.coordinator_role[]));

create policy "rsvp team reads revisions" on public.rsvp_revisions for select to authenticated using (public.has_wedding_role(array['owner', 'rsvp']::public.coordinator_role[]));

create policy "rsvp team reads activity" on public.coordinator_activity for select to authenticated using (public.has_wedding_role(array['owner', 'rsvp']::public.coordinator_role[]));

create policy "owners manage roles" on public.admin_roles for all to authenticated using (public.is_wedding_owner()) with check (public.is_wedding_owner());

-- Dashboard writes cannot impersonate a confirmer, and coordinator changes create
-- append-only history. Guest RPC writes use service_role and add one complete,
-- whitelisted guest revision after all attendance rows are saved.
create or replace function public.set_rsvp_confirmation_actor()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if new.coordinator_confirmed then
    if auth.role() = 'authenticated' then
      new.confirmed_by := auth.uid();
      new.confirmed_at := now();
    end if;
  else
    new.confirmed_by := null;
    new.confirmed_at := null;
  end if;
  return new;
end;
$$;

create or replace function public.audit_coordinator_rsvp_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_snapshot jsonb;
begin
  if auth.role() = 'service_role' then return null; end if;
  v_snapshot := to_jsonb(new);
  insert into public.rsvp_revisions (rsvp_id, source, changed_by, payload)
  values (
    new.id,
    'coordinator',
    auth.uid(),
    jsonb_build_object('operation', tg_op, 'rsvp', v_snapshot)
  );
  return null;
end;
$$;

create or replace function public.audit_coordinator_attendance_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_snapshot jsonb;
begin
  if auth.role() = 'service_role' then return null; end if;
  v_snapshot := to_jsonb(new);
  insert into public.rsvp_revisions (rsvp_id, source, changed_by, payload)
  values (
    new.rsvp_id,
    'coordinator',
    auth.uid(),
    jsonb_build_object('operation', tg_op, 'attendance', v_snapshot)
  );
  return null;
end;
$$;

create or replace function public.set_activity_actor()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if auth.role() = 'authenticated' then new.actor_id := auth.uid(); end if;
  return new;
end;
$$;

create or replace function public.enforce_coordinator_rsvp_status()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if auth.role() = 'service_role' then return new; end if;
  if new.status <> 'attending' and exists (
    select 1
    from public.rsvp_event_attendance
    where rsvp_id = new.id and is_attending
  ) then
    raise exception 'Only attending RSVPs can select events' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_coordinator_attendance_limit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_invitation_id uuid;
  v_status public.rsvp_status;
  v_adult_limit smallint;
  v_child_limit smallint;
begin
  if auth.role() = 'service_role' then return new; end if;
  select invitation_id, status into v_invitation_id, v_status
  from public.rsvps
  where id = new.rsvp_id;
  if not found then
    raise exception 'RSVP could not be found' using errcode = 'P0001';
  end if;
  if new.is_attending and v_status <> 'attending' then
    raise exception 'Only attending RSVPs can select events' using errcode = 'P0001';
  end if;
  select adult_limit, child_limit into v_adult_limit, v_child_limit
  from public.invitation_events invitation_event
  join public.events event on event.id = invitation_event.event_id and event.published = true
  where invitation_event.invitation_id = v_invitation_id and invitation_event.event_id = new.event_id;
  if not found then
    raise exception 'This event is not included in the invitation' using errcode = 'P0001';
  end if;
  if new.adult_count > v_adult_limit or new.child_count > v_child_limit then
    raise exception 'Guest count exceeds invitation limit' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function public.log_coordinator_activity(p_invitation_id uuid, p_action text, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_activity_id uuid;
begin
  if not public.has_wedding_role(array['owner', 'rsvp']::public.coordinator_role[]) then
    raise exception 'Coordinator access is required' using errcode = 'P0001';
  end if;
  if p_action not in ('follow_up', 'phone_reply', 'whatsapp_reply', 'manual_rsvp', 'invitation_revoked') then
    raise exception 'Invalid coordinator action' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_note, '')) > 500 then
    raise exception 'Activity note is too long' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.invitations where id = p_invitation_id) then
    raise exception 'Invitation could not be found' using errcode = 'P0001';
  end if;
  insert into public.coordinator_activity (invitation_id, actor_id, action, note)
  values (p_invitation_id, auth.uid(), p_action, nullif(trim(p_note), ''))
  returning id into v_activity_id;
  return v_activity_id;
end;
$$;

create or replace function public.prevent_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception 'Audit records are append-only' using errcode = 'P0001';
  return null;
end;
$$;

revoke all on function public.set_rsvp_confirmation_actor() from public, anon, authenticated;
revoke all on function public.audit_coordinator_rsvp_change() from public, anon, authenticated;
revoke all on function public.audit_coordinator_attendance_change() from public, anon, authenticated;
revoke all on function public.set_activity_actor() from public, anon, authenticated;
revoke all on function public.enforce_coordinator_rsvp_status() from public, anon, authenticated;
revoke all on function public.enforce_coordinator_attendance_limit() from public, anon, authenticated;
revoke all on function public.prevent_audit_mutation() from public, anon, authenticated;
revoke all on function public.log_coordinator_activity(uuid, text, text) from public, anon, authenticated;
grant execute on function public.log_coordinator_activity(uuid, text, text) to authenticated;

create trigger rsvps_confirmation_actor before insert or update on public.rsvps for each row execute function public.set_rsvp_confirmation_actor();
create trigger rsvps_status_guard before insert or update on public.rsvps for each row execute function public.enforce_coordinator_rsvp_status();
create trigger rsvps_coordinator_audit after insert or update on public.rsvps for each row execute function public.audit_coordinator_rsvp_change();
create trigger attendance_limit_guard before insert or update on public.rsvp_event_attendance for each row execute function public.enforce_coordinator_attendance_limit();
create trigger attendance_coordinator_audit after insert or update on public.rsvp_event_attendance for each row execute function public.audit_coordinator_attendance_change();
create trigger coordinator_activity_actor before insert on public.coordinator_activity for each row execute function public.set_activity_actor();
create trigger rsvp_revisions_append_only before update or delete on public.rsvp_revisions for each row execute function public.prevent_audit_mutation();
create trigger coordinator_activity_append_only before update or delete on public.coordinator_activity for each row execute function public.prevent_audit_mutation();

-- Server-only RSVP write path. It checks the raw invitation token only after the
-- Next.js server has HMAC-hashed it, locks the invitation, enforces its event/count
-- limits, updates the current RSVP, and preserves an immutable revision.
create or replace function public.submit_rsvp(p_token_hash text, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_invitation public.invitations%rowtype;
  v_rsvp_id uuid;
  v_item jsonb;
  v_event_id uuid;
  v_adult_limit smallint;
  v_child_limit smallint;
  v_attending boolean;
  v_adults smallint;
  v_children smallint;
  v_selected_count integer := 0;
  v_status public.rsvp_status;
  v_seen_event_ids uuid[] := '{}'::uuid[];
  v_revision_payload jsonb;
begin
  if coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Invitation is unavailable' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'RSVP details are required' using errcode = 'P0001';
  end if;
  select * into v_invitation
  from public.invitations
  where token_hash = p_token_hash and status = 'active' and access_expires_at >= now()
  for update;

  if not found then
    raise exception 'Invitation is unavailable' using errcode = 'P0001';
  end if;
  if v_invitation.can_edit_until < now() then
    raise exception 'Online RSVP is closed' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_payload -> 'attendances') <> 'array' then
    raise exception 'Attendance details are required' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_payload -> 'attendances') > 12 then
    raise exception 'Too many attendance details' using errcode = 'P0001';
  end if;

  begin
    v_status := (p_payload ->> 'status')::public.rsvp_status;
  exception when invalid_text_representation then
    raise exception 'Invalid RSVP status' using errcode = 'P0001';
  end;
  if v_status is null then
    raise exception 'Invalid RSVP status' using errcode = 'P0001';
  end if;
  if coalesce(char_length(trim(p_payload ->> 'respondent_name')), 0) < 2
    or char_length(trim(p_payload ->> 'respondent_name')) > 100 then
    raise exception 'Respondent name is required' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_payload ->> 'comfort_note', '')) > 500 then
    raise exception 'Comfort note is too long' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_payload ->> 'decline_message', '')) > 500 then
    raise exception 'Message is too long' using errcode = 'P0001';
  end if;
  if v_status <> 'attending' and nullif(trim(p_payload ->> 'comfort_note'), '') is not null then
    raise exception 'Comfort notes are only available for attending guests' using errcode = 'P0001';
  end if;
  if v_status <> 'declined' and nullif(trim(p_payload ->> 'decline_message'), '') is not null then
    raise exception 'A message for the couple is only available for declined RSVPs' using errcode = 'P0001';
  end if;

  for v_item in select value from jsonb_array_elements(p_payload -> 'attendances') loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Invalid attendance details' using errcode = 'P0001';
    end if;
    begin
      v_event_id := (v_item ->> 'event_id')::uuid;
      v_attending := coalesce((v_item ->> 'attending')::boolean, false);
      v_adults := coalesce((v_item ->> 'adults')::smallint, 0);
      v_children := coalesce((v_item ->> 'children')::smallint, 0);
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Invalid attendance details' using errcode = 'P0001';
    end;

    if v_event_id = any(v_seen_event_ids) then
      raise exception 'Each event can only appear once' using errcode = 'P0001';
    end if;
    v_seen_event_ids := array_append(v_seen_event_ids, v_event_id);

    select adult_limit, child_limit into v_adult_limit, v_child_limit
    from public.invitation_events invitation_event
    join public.events event on event.id = invitation_event.event_id and event.published = true
    where invitation_event.invitation_id = v_invitation.id and invitation_event.event_id = v_event_id;
    if not found then
      raise exception 'This event is not included in the invitation' using errcode = 'P0001';
    end if;
    if v_adults < 0 or v_children < 0 or v_adults > v_adult_limit or v_children > v_child_limit then
      raise exception 'Guest count exceeds invitation limit' using errcode = 'P0001';
    end if;
    if not v_attending and (v_adults > 0 or v_children > 0) then
      raise exception 'Counts require attendance' using errcode = 'P0001';
    end if;
    if v_attending and v_adults + v_children = 0 then
      raise exception 'Attending events need at least one guest' using errcode = 'P0001';
    end if;
    if v_attending then v_selected_count := v_selected_count + 1; end if;
  end loop;

  if v_status <> 'attending' and v_selected_count > 0 then
    raise exception 'Only attending RSVPs can select events' using errcode = 'P0001';
  end if;
  if v_status = 'attending' and v_selected_count = 0 then
    raise exception 'Please select at least one event' using errcode = 'P0001';
  end if;

  insert into public.rsvps (invitation_id, respondent_name, status, comfort_note, decline_message, coordinator_confirmed, confirmed_by, confirmed_at)
  values (v_invitation.id, trim(p_payload ->> 'respondent_name'), v_status, nullif(trim(p_payload ->> 'comfort_note'), ''), nullif(trim(p_payload ->> 'decline_message'), ''), false, null, null)
  on conflict (invitation_id) do update set
    respondent_name = excluded.respondent_name,
    status = excluded.status,
    comfort_note = excluded.comfort_note,
    decline_message = excluded.decline_message,
    coordinator_confirmed = false,
    confirmed_by = null,
    confirmed_at = null,
    updated_at = now()
  returning id into v_rsvp_id;

  delete from public.rsvp_event_attendance where rsvp_id = v_rsvp_id;
  for v_item in select value from jsonb_array_elements(p_payload -> 'attendances') loop
    insert into public.rsvp_event_attendance (rsvp_id, event_id, is_attending, adult_count, child_count)
    values (
      v_rsvp_id,
      (v_item ->> 'event_id')::uuid,
      coalesce((v_item ->> 'attending')::boolean, false),
      coalesce((v_item ->> 'adults')::smallint, 0),
      coalesce((v_item ->> 'children')::smallint, 0)
    );
  end loop;

  select jsonb_build_object(
    'respondent_name', trim(p_payload ->> 'respondent_name'),
    'status', v_status,
    'comfort_note', nullif(trim(p_payload ->> 'comfort_note'), ''),
    'decline_message', nullif(trim(p_payload ->> 'decline_message'), ''),
    'attendances', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'event_id', event_id,
          'attending', is_attending,
          'adults', adult_count,
          'children', child_count
        ) order by event_id
      ),
      '[]'::jsonb
    )
  ) into v_revision_payload
  from public.rsvp_event_attendance
  where rsvp_id = v_rsvp_id;

  insert into public.rsvp_revisions (rsvp_id, source, payload)
  values (v_rsvp_id, 'guest', v_revision_payload);
  insert into public.coordinator_activity (invitation_id, action, note)
  values (v_invitation.id, 'guest_rsvp', 'Guest submitted or updated RSVP');

  return v_rsvp_id;
end;
$$;

revoke all on function public.submit_rsvp(text, jsonb) from public, anon, authenticated;
grant execute on function public.submit_rsvp(text, jsonb) to service_role;

-- Transactional import helper. It is service-role-only and is intended for a
-- protected server-side import workflow, not the browser. A malformed household
-- rolls back as one unit.
create or replace function public.create_invitation_bundle(p_invitation jsonb, p_event_limits jsonb)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_invitation_id uuid;
  v_item jsonb;
  v_event_id uuid;
  v_adults smallint;
  v_children smallint;
  v_status public.invitation_status;
  v_seen_event_ids uuid[] := '{}'::uuid[];
begin
  if jsonb_typeof(p_invitation) <> 'object' then
    raise exception 'Invitation details are required' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_event_limits) <> 'array' or jsonb_array_length(p_event_limits) = 0 then
    raise exception 'At least one event is required' using errcode = 'P0001';
  end if;
  if coalesce(p_invitation ->> 'token_hash', '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid invitation token hash' using errcode = 'P0001';
  end if;
  begin
    v_status := coalesce((p_invitation ->> 'status')::public.invitation_status, 'active');
  exception when invalid_text_representation then
    raise exception 'Invalid invitation status' using errcode = 'P0001';
  end;

  insert into public.invitations (
    external_key, token_hash, status, household_name_en, household_name_hi,
    preferred_locale, primary_contact_phone, family_side, city, is_outstation,
    tags, rsvp_deadline, can_edit_until, access_expires_at
  ) values (
    trim(p_invitation ->> 'external_key'),
    p_invitation ->> 'token_hash',
    v_status,
    trim(p_invitation ->> 'household_name_en'),
    trim(p_invitation ->> 'household_name_hi'),
    coalesce(p_invitation ->> 'preferred_locale', 'en'),
    nullif(trim(p_invitation ->> 'primary_contact_phone'), ''),
    nullif(trim(p_invitation ->> 'family_side'), ''),
    nullif(trim(p_invitation ->> 'city'), ''),
    coalesce((p_invitation ->> 'is_outstation')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_invitation -> 'tags', '[]'::jsonb))), '{}'::text[]),
    (p_invitation ->> 'rsvp_deadline')::timestamptz,
    (p_invitation ->> 'can_edit_until')::timestamptz,
    (p_invitation ->> 'access_expires_at')::timestamptz
  ) returning id into v_invitation_id;

  for v_item in select value from jsonb_array_elements(p_event_limits) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Invalid event limit' using errcode = 'P0001';
    end if;
    begin
      v_event_id := (v_item ->> 'event_id')::uuid;
      v_adults := (v_item ->> 'adult_limit')::smallint;
      v_children := (v_item ->> 'child_limit')::smallint;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Invalid event limit' using errcode = 'P0001';
    end;
    if v_event_id = any(v_seen_event_ids) then
      raise exception 'Duplicate event limit' using errcode = 'P0001';
    end if;
    v_seen_event_ids := array_append(v_seen_event_ids, v_event_id);
    if v_adults is null
      or v_children is null
      or v_adults < 0
      or v_children < 0
      or v_adults > 30
      or v_children > 30
      or v_adults + v_children <= 0 then
      raise exception 'Invalid guest limit' using errcode = 'P0001';
    end if;
    if not exists (
      select 1
      from public.events
      where id = v_event_id and (v_status <> 'active' or published)
    ) then
      raise exception 'An event could not be found' using errcode = 'P0001';
    end if;
    insert into public.invitation_events (invitation_id, event_id, adult_limit, child_limit)
    values (v_invitation_id, v_event_id, v_adults, v_children);
  end loop;

  insert into public.coordinator_activity (invitation_id, action, note)
  values (v_invitation_id, 'invitation_imported', 'Invitation created by CSV import');
  return v_invitation_id;
end;
$$;

revoke all on function public.create_invitation_bundle(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_invitation_bundle(jsonb, jsonb) to service_role;

comment on table public.invitations is 'Do not expose this table directly to anonymous or browser clients.';
comment on function public.submit_rsvp(text, jsonb) is 'Call only from the server with an HMAC-SHA-256 invite token digest.';
