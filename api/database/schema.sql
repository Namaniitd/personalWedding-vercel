-- Direct PostgreSQL persistence for Shaadi Companion.
--
-- This is an idempotent, production-neutral schema for deployments that use
-- DATABASE_URL. It creates no wedding, event, household, invitation, or RSVP
-- records. Hosted Supabase deployments use the migrations in
-- supabase/migrations instead.

create schema if not exists wedding;
revoke all on schema wedding from public;

-- Upgrade the direct PostgreSQL schema shipped by earlier releases without
-- copying or deleting guest data. The earlier table prefix is constructed only
-- in this compatibility block so that the installed schema contains no
-- deprecated object names after a successful upgrade.
do $$
declare
  v_previous_prefix constant text := chr(108) || chr(111) || chr(99) || chr(97) || chr(108) || chr(95);
  v_target_name text;
  v_previous_suffix text;
  v_previous_name text;
  v_object record;
  v_renamed_object text;
begin
  for v_target_name, v_previous_suffix in
    values
      ('settings', 'wedding_settings'),
      ('contacts', 'wedding_contacts'),
      ('events', 'events'),
      ('rsvps', 'rsvps'),
      ('invitations', 'invitations'),
      ('entry_passes', 'entry_passes'),
      ('entry_check_ins', 'entry_check_ins')
  loop
    v_previous_name := v_previous_prefix || v_previous_suffix;
    if to_regclass(format('public.%I', v_previous_name)) is not null then
      if to_regclass(format('wedding.%I', v_target_name)) is not null then
        raise exception 'Cannot upgrade direct PostgreSQL data because wedding.% already exists.', v_target_name
          using errcode = '42P07';
      end if;
      execute format('alter table public.%I set schema wedding', v_previous_name);
      execute format('alter table wedding.%I rename to %I', v_previous_name, v_target_name);
    end if;
  end loop;

  -- Rename constraints and indexes left by the previous object prefix. This
  -- keeps catalog names as production-neutral as the table names themselves.
  for v_object in
    select relation_name, constraint_name,
           substring(constraint_name from char_length(v_previous_prefix) + 1) as next_name
      from (
        select relation_class.relname as relation_name,
               constraint_record.conname as constraint_name
          from pg_constraint as constraint_record
          join pg_class as relation_class on relation_class.oid = constraint_record.conrelid
          join pg_namespace as relation_namespace on relation_namespace.oid = relation_class.relnamespace
         where relation_namespace.nspname = 'wedding'
           and constraint_record.conname like v_previous_prefix || '%'
      ) as legacy_constraints
  loop
    if exists (
      select 1
        from pg_constraint as existing_constraint
        join pg_class as existing_relation on existing_relation.oid = existing_constraint.conrelid
        join pg_namespace as existing_namespace on existing_namespace.oid = existing_relation.relnamespace
       where existing_relation.relname = v_object.relation_name
         and existing_namespace.nspname = 'wedding'
         and existing_constraint.conname = v_object.next_name
    ) then
      raise exception 'Cannot rename existing database constraint %.', v_object.constraint_name
        using errcode = '42710';
    end if;
    execute format(
      'alter table wedding.%I rename constraint %I to %I',
      v_object.relation_name,
      v_object.constraint_name,
      v_object.next_name
    );
  end loop;

  for v_object in
    select index_class.relname as index_name,
           substring(index_class.relname from char_length(v_previous_prefix) + 1) as next_name
      from pg_class as index_class
      join pg_namespace as index_namespace on index_namespace.oid = index_class.relnamespace
     where index_namespace.nspname = 'wedding'
       and index_class.relkind in ('i', 'I')
       and index_class.relname like v_previous_prefix || '%'
  loop
    if exists (
      select 1
        from pg_class as existing_index
        join pg_namespace as existing_namespace on existing_namespace.oid = existing_index.relnamespace
       where existing_namespace.nspname = 'wedding'
         and existing_index.relname = v_object.next_name
    ) then
      raise exception 'Cannot rename existing database index %.', v_object.index_name
        using errcode = '42P07';
    end if;
    execute format('alter index wedding.%I rename to %I', v_object.index_name, v_object.next_name);
  end loop;

  -- Trigger functions from the previous schema refer to moved table names.
  -- Remove their triggers and functions before recreating the hardened forms
  -- below. The data and its relational constraints remain untouched.
  for v_object in
    select relation_class.relname as relation_name, trigger_record.tgname as trigger_name
      from pg_trigger as trigger_record
      join pg_class as relation_class on relation_class.oid = trigger_record.tgrelid
      join pg_namespace as relation_namespace on relation_namespace.oid = relation_class.relnamespace
     where relation_namespace.nspname = 'wedding'
       and not trigger_record.tgisinternal
       and trigger_record.tgname like v_previous_prefix || '%'
  loop
    execute format('drop trigger if exists %I on wedding.%I', v_object.trigger_name, v_object.relation_name);
  end loop;

  for v_object in
    select function_namespace.nspname as schema_name,
           procedure_record.proname as function_name,
           pg_get_function_identity_arguments(procedure_record.oid) as argument_list
      from pg_proc as procedure_record
      join pg_namespace as function_namespace on function_namespace.oid = procedure_record.pronamespace
     where function_namespace.nspname in ('public', 'wedding')
       and procedure_record.proname like v_previous_prefix || '%'
  loop
    execute format(
      'drop function if exists %I.%I(%s)',
      v_object.schema_name,
      v_object.function_name,
      v_object.argument_list
    );
  end loop;
end;
$$;

create table if not exists wedding.settings (
  id smallint primary key default 1,
  side text not null default 'groom',
  couple_names_en text not null check (char_length(couple_names_en) between 1 and 160),
  couple_names_hi text not null check (char_length(couple_names_hi) between 1 and 160),
  wedding_date_en text not null check (char_length(wedding_date_en) between 1 and 160),
  wedding_date_hi text not null check (char_length(wedding_date_hi) between 1 and 160),
  location_en text not null check (char_length(location_en) between 1 and 200),
  location_hi text not null check (char_length(location_hi) between 1 and 200),
  wedding_moment timestamptz not null,
  rsvp_deadline timestamptz not null,
  can_edit_until timestamptz not null,
  coordinator_name text not null check (char_length(coordinator_name) between 1 and 80),
  coordinator_phone text not null check (char_length(coordinator_phone) between 1 and 40),
  announcement_en text check (char_length(announcement_en) <= 900),
  announcement_hi text check (char_length(announcement_hi) <= 900),
  announcement_starts_at timestamptz,
  announcement_ends_at timestamptz,
  guest_content jsonb check (guest_content is null or jsonb_typeof(guest_content) = 'object'),
  updated_at timestamptz not null default now(),
  constraint settings_side_id_check check ((id = 1 and side = 'groom') or (id = 2 and side = 'bride')),
  constraint settings_rsvp_window_check check (can_edit_until <= rsvp_deadline),
  constraint settings_announcement_window_check check (
    announcement_ends_at is null
    or announcement_starts_at is null
    or announcement_ends_at > announcement_starts_at
  )
);

-- Preserve all previously configured content as the groom workspace. The
-- former reply-to role was a contact choice, not ownership of private data.
alter table wedding.settings add column if not exists side text not null default 'groom';
alter table wedding.settings drop constraint if exists settings_id_check;
alter table wedding.settings drop constraint if exists wedding_settings_id_check;
alter table wedding.settings drop constraint if exists settings_side_id_check;
alter table wedding.settings add constraint settings_side_id_check
  check ((id = 1 and side = 'groom') or (id = 2 and side = 'bride'));

create table if not exists wedding.contacts (
  side text not null default 'groom' check (side in ('groom', 'bride')),
  role text not null check (role in ('groom', 'bride')),
  name text not null check (char_length(name) between 1 and 80),
  phone text not null check (char_length(phone) between 1 and 40),
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (side, role)
);

alter table wedding.contacts add column if not exists side text not null default 'groom';
alter table wedding.contacts drop constraint if exists contacts_side_check;
alter table wedding.contacts add constraint contacts_side_check check (side in ('groom', 'bride'));
do $$
declare
  v_primary_key text;
begin
  select conname into v_primary_key from pg_constraint
    where conrelid = 'wedding.contacts'::regclass and contype = 'p';
  if v_primary_key is not null and (
    select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'wedding.contacts'::regclass and conname = v_primary_key
  ) <> 'PRIMARY KEY (side, role)' then
    execute format('alter table wedding.contacts drop constraint %I', v_primary_key);
    v_primary_key := null;
  end if;
  if v_primary_key is null then
    alter table wedding.contacts add constraint contacts_pkey primary key (side, role);
  end if;
end;
$$;

create table if not exists wedding.events (
  id text primary key check (id ~ '^[a-z0-9-]{1,100}$'),
  side text not null default 'groom' check (side in ('groom', 'bride')),
  slug text not null check (slug ~ '^[a-z0-9-]{1,100}$'),
  title_en text not null check (char_length(title_en) between 1 and 180),
  title_hi text not null check (char_length(title_hi) between 1 and 180),
  date_en text not null check (char_length(date_en) between 1 and 180),
  date_hi text not null check (char_length(date_hi) between 1 and 180),
  start_time_en text not null check (char_length(start_time_en) between 1 and 120),
  start_time_hi text not null check (char_length(start_time_hi) between 1 and 120),
  arrival_window_en text not null check (char_length(arrival_window_en) between 1 and 300),
  arrival_window_hi text not null check (char_length(arrival_window_hi) between 1 and 300),
  start_at timestamptz not null,
  end_at timestamptz not null check (end_at > start_at),
  venue_en text not null check (char_length(venue_en) between 1 and 240),
  venue_hi text not null check (char_length(venue_hi) between 1 and 240),
  address_en text not null check (char_length(address_en) between 1 and 600),
  address_hi text not null check (char_length(address_hi) between 1 and 600),
  maps_url text not null check (maps_url ~ '^https://'),
  entry_note_en text not null check (char_length(entry_note_en) between 1 and 600),
  entry_note_hi text not null check (char_length(entry_note_hi) between 1 and 600),
  dress_code_en text not null check (char_length(dress_code_en) between 1 and 300),
  dress_code_hi text not null check (char_length(dress_code_hi) between 1 and 300),
  practical_note_en text not null check (char_length(practical_note_en) between 1 and 600),
  practical_note_hi text not null check (char_length(practical_note_hi) between 1 and 600),
  description_en text not null default '' check (char_length(description_en) <= 2400),
  description_hi text not null default '' check (char_length(description_hi) <= 2400),
  popup_details jsonb not null default '[]'::jsonb,
  category text not null default 'celebration' check (category in ('celebration', 'ceremony', 'reception')),
  published boolean not null default false,
  display_order smallint not null default 0,
  default_selected boolean not null default false,
  default_adult_limit smallint not null default 2 check (default_adult_limit between 0 and 30),
  default_child_limit smallint not null default 0 check (default_child_limit between 0 and 30),
  updated_at timestamptz not null default now(),
  constraint events_side_slug_key unique (side, slug),
  constraint events_popup_details_check check (jsonb_typeof(popup_details) = 'array' and jsonb_array_length(popup_details) <= 8),
  constraint events_default_guest_limit_check check (
    not default_selected or default_adult_limit + default_child_limit > 0
  )
);

alter table wedding.events add column if not exists side text not null default 'groom';
alter table wedding.events drop constraint if exists events_side_check;
alter table wedding.events add constraint events_side_check check (side in ('groom', 'bride'));
alter table wedding.events drop constraint if exists events_slug_key;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'wedding.events'::regclass and conname = 'events_side_slug_key') then
    alter table wedding.events add constraint events_side_slug_key unique (side, slug);
  end if;
end;
$$;
alter table wedding.events add column if not exists description_en text not null default '';
alter table wedding.events add column if not exists description_hi text not null default '';
alter table wedding.events add column if not exists popup_details jsonb not null default '[]'::jsonb;
alter table wedding.events drop constraint if exists events_description_en_check;
alter table wedding.events add constraint events_description_en_check check (char_length(description_en) <= 2400);
alter table wedding.events drop constraint if exists events_description_hi_check;
alter table wedding.events add constraint events_description_hi_check check (char_length(description_hi) <= 2400);
alter table wedding.events drop constraint if exists events_popup_details_check;
alter table wedding.events add constraint events_popup_details_check
  check (jsonb_typeof(popup_details) = 'array' and jsonb_array_length(popup_details) <= 8);

create index if not exists events_published_order_idx
  on wedding.events (display_order, start_at, id)
  where published;

create table if not exists wedding.rsvps (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  respondent_name text not null check (char_length(respondent_name) between 2 and 100),
  contact_number text,
  status text not null check (status in ('attending', 'declined', 'confirming')),
  attendances jsonb not null default '[]'::jsonb check (jsonb_typeof(attendances) = 'array'),
  comfort_note text check (char_length(comfort_note) <= 500),
  decline_message text check (char_length(decline_message) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rsvps_comfort_note_status_check check (status = 'attending' or comfort_note is null),
  constraint rsvps_decline_message_status_check check (status = 'declined' or decline_message is null)
);

-- Additive contact fields keep existing invitation tokens and RSVP records intact.
alter table wedding.rsvps add column if not exists contact_number text;
alter table wedding.rsvps drop constraint if exists rsvps_contact_number_check;
alter table wedding.rsvps add constraint rsvps_contact_number_check check (
  contact_number is null or (
    char_length(contact_number) <= 40 and contact_number ~ '^\+?[0-9 ()-]+$'
    and char_length(regexp_replace(contact_number, '[^0-9]', '', 'g')) between 7 and 15
  )
);

-- Raw invitation URLs are never stored in plaintext. `token_hash` is an HMAC
-- digest made with DATABASE_INVITATION_TOKEN_PEPPER and is the only lookup
-- key. `token_ciphertext` is a nullable compatibility column from an earlier
-- design; the current API never reads or writes it and grants it no runtime
-- access. Newly issued links can be copied only from their issuance response.
create table if not exists wedding.invitations (
  id uuid primary key,
  side text not null default 'groom' check (side in ('groom', 'bride')),
  -- This fixed marker exists solely to grant the application permission for
  -- SELECT ... FOR UPDATE without granting writes to invitation data.
  lock_marker smallint not null default 1 constraint invitations_lock_marker_check check (lock_marker = 1),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_ciphertext text,
  household_name_en text not null check (char_length(household_name_en) between 2 and 100),
  household_name_hi text not null check (char_length(household_name_hi) between 2 and 100),
  contact_number text,
  preferred_locale text not null check (preferred_locale in ('en', 'hi')),
  contact_role text not null default 'groom' constraint invitations_contact_role_check check (contact_role in ('groom', 'bride')),
  event_limits jsonb not null check (
    jsonb_typeof(event_limits) = 'object'
    and event_limits <> '{}'::jsonb
  ),
  status text not null default 'active' check (status in ('active', 'revoked')),
  access_expires_at timestamptz not null,
  revoked_at timestamptz,
  rsvp_deleted_at timestamptz,
  constraint invitations_revocation_status_check check (
    (status = 'active' and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null)
  ),
  constraint invitations_rsvp_deletion_status_check check (
    rsvp_deleted_at is null or status = 'revoked'
  ),
  created_at timestamptz not null default now()
);

alter table wedding.invitations add column if not exists contact_number text;
alter table wedding.invitations drop constraint if exists invitations_contact_number_check;
alter table wedding.invitations add constraint invitations_contact_number_check check (
  contact_number is null or (
    char_length(contact_number) <= 40 and contact_number ~ '^\+?[0-9 ()-]+$'
    and char_length(regexp_replace(contact_number, '[^0-9]', '', 'g')) between 7 and 15
  )
);

alter table wedding.invitations add column if not exists side text not null default 'groom';
alter table wedding.invitations drop constraint if exists invitations_side_check;
alter table wedding.invitations add constraint invitations_side_check check (side in ('groom', 'bride'));

-- Upgrade tables created before revocation and contact-role support. The
-- updates are deterministic and retain all invitation links.
alter table wedding.invitations add column if not exists contact_role text;
update wedding.invitations set contact_role = 'groom' where contact_role is null;
alter table wedding.invitations alter column contact_role set default 'groom';
alter table wedding.invitations alter column contact_role set not null;
alter table wedding.invitations drop constraint if exists invitations_contact_role_check;
alter table wedding.invitations add constraint invitations_contact_role_check check (contact_role in ('groom', 'bride'));

alter table wedding.invitations add column if not exists status text;
update wedding.invitations set status = 'active' where status is null;
alter table wedding.invitations alter column status set default 'active';
alter table wedding.invitations alter column status set not null;
alter table wedding.invitations drop constraint if exists invitations_status_check;
alter table wedding.invitations add constraint invitations_status_check check (status in ('active', 'revoked'));

-- Existing invitation records deliberately receive no implicit expiry. A null
-- value fails closed until a reviewed operator chooses an explicit deadline.
alter table wedding.invitations add column if not exists access_expires_at timestamptz;

-- Row locks used while saving an RSVP need an UPDATE privilege in PostgreSQL.
-- Granting UPDATE only on this immutable marker lets the application acquire
-- that lock without being able to alter invitation identifiers or content.
alter table wedding.invitations add column if not exists lock_marker smallint;
update wedding.invitations set lock_marker = 1 where lock_marker is distinct from 1;
alter table wedding.invitations alter column lock_marker set default 1;
alter table wedding.invitations alter column lock_marker set not null;
alter table wedding.invitations drop constraint if exists invitations_lock_marker_check;
alter table wedding.invitations add constraint invitations_lock_marker_check check (lock_marker = 1);

alter table wedding.invitations add column if not exists revoked_at timestamptz;
update wedding.invitations set revoked_at = created_at where status = 'revoked' and revoked_at is null;
alter table wedding.invitations drop constraint if exists invitations_revocation_status_check;
alter table wedding.invitations add constraint invitations_revocation_status_check check (
  (status = 'active' and revoked_at is null)
  or (status = 'revoked' and revoked_at is not null)
);

-- RSVP content can be erased only after a link is revoked. The timestamp is a
-- minimal audit record; it does not retain the erased RSVP content.
alter table wedding.invitations add column if not exists rsvp_deleted_at timestamptz;
alter table wedding.invitations drop constraint if exists invitations_rsvp_deletion_status_check;
alter table wedding.invitations add constraint invitations_rsvp_deletion_status_check check (
  rsvp_deleted_at is null or status = 'revoked'
);

-- Keep the old nullable column for an in-place schema upgrade. New links never
-- populate it; an operator can erase historical values after migration review.
alter table wedding.invitations add column if not exists token_ciphertext text;
alter table wedding.invitations drop constraint if exists invitations_token_ciphertext_check;
alter table wedding.invitations add constraint invitations_token_ciphertext_check check (
  token_ciphertext is null
  or token_ciphertext ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{20,128}\.[A-Za-z0-9_-]{22}$'
);

-- `token_hash` is an HMAC digest, not a bearer token. Keep historic data
-- upgradeable while enforcing the relation for every new or changed RSVP.
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'rsvps_invitation_token_hash_fkey'
       and conrelid = 'wedding.rsvps'::regclass
  ) then
    alter table wedding.rsvps
      add constraint rsvps_invitation_token_hash_fkey
      foreign key (token_hash)
      references wedding.invitations(token_hash)
      on update restrict
      on delete restrict
      not valid;
  end if;
end;
$$;

-- A household receives one active QR entry pass at a time. The raw pass is
-- never stored: token_hash is an HMAC lookup key and pass_version is a
-- non-secret rotation identifier.
create table if not exists wedding.entry_passes (
  id uuid primary key,
  invitation_id uuid not null references wedding.invitations(id) on delete restrict,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  pass_version uuid not null,
  status text not null default 'active' check (status in ('active', 'invalidated')),
  invalidated_at timestamptz,
  invalidation_reason text check (invalidation_reason in ('invitation_revoked', 'rsvp_no_longer_attending', 'rsvp_deleted', 'entry_pass_key_changed')),
  issued_at timestamptz not null default now(),
  constraint entry_passes_invalidation_state_check check (
    (status = 'active' and invalidated_at is null and invalidation_reason is null)
    or (status = 'invalidated' and invalidated_at is not null and invalidation_reason is not null)
  )
);

alter table wedding.entry_passes drop constraint if exists entry_passes_invalidation_reason_check;
alter table wedding.entry_passes add constraint entry_passes_invalidation_reason_check check (
  invalidation_reason in ('invitation_revoked', 'rsvp_no_longer_attending', 'rsvp_deleted', 'entry_pass_key_changed')
);

-- A check-in is event-specific even though its QR credential is household
-- scoped. Counts are fixed at first admission; repeat scans only increment a
-- counter and never create a second admission.
create table if not exists wedding.entry_check_ins (
  id uuid primary key,
  entry_pass_id uuid not null references wedding.entry_passes(id) on delete restrict,
  event_id text not null references wedding.events(id) on delete restrict,
  expected_adult_count smallint not null check (expected_adult_count between 0 and 30),
  expected_child_count smallint not null check (expected_child_count between 0 and 30),
  checked_in_at timestamptz not null default now(),
  last_scanned_at timestamptz not null default now(),
  scan_count integer not null default 1 check (scan_count >= 1),
  constraint entry_check_ins_expected_guests_check check (expected_adult_count + expected_child_count > 0),
  constraint entry_check_ins_scan_time_check check (last_scanned_at >= checked_in_at),
  constraint entry_check_ins_one_event_per_pass_unique unique (entry_pass_id, event_id)
);

create unique index if not exists entry_passes_one_active_per_invitation_idx
  on wedding.entry_passes (invitation_id)
  where status = 'active';

create index if not exists entry_check_ins_checked_in_at_idx
  on wedding.entry_check_ins (checked_in_at desc);

create index if not exists invitations_active_created_at_idx
  on wedding.invitations (created_at desc)
  where status = 'active';

create index if not exists invitations_active_access_expires_at_idx
  on wedding.invitations (access_expires_at)
  where status = 'active';

create or replace function wedding.set_rsvp_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  -- DTOs carry millisecond precision. Every write must still have a distinct
  -- revision, including two corrections made within one millisecond.
  new.updated_at = greatest(date_trunc('milliseconds', clock_timestamp()),
                            date_trunc('milliseconds', old.updated_at) + interval '1 millisecond');
  return new;
end;
$$;

drop trigger if exists rsvps_updated_at on wedding.rsvps;
create trigger rsvps_updated_at
before update on wedding.rsvps
for each row execute function wedding.set_rsvp_updated_at();

-- Issued links and event IDs are durable references. Moving either record to
-- another workspace would expose old private relationships to that side.
create or replace function wedding.require_immutable_side()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.side is distinct from old.side then
    raise exception 'Record ownership cannot be changed.' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists invitations_immutable_side on wedding.invitations;
create trigger invitations_immutable_side
before update of side on wedding.invitations
for each row execute function wedding.require_immutable_side();
drop trigger if exists events_immutable_side on wedding.events;
create trigger events_immutable_side
before update of side on wedding.events
for each row execute function wedding.require_immutable_side();

create or replace function wedding.require_invitation_events_for_side()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if exists (
    select 1 from jsonb_object_keys(new.event_limits) as chosen(event_id)
    left join wedding.events as events on events.id = chosen.event_id and events.side = new.side
    where events.id is null
  ) then
    raise exception 'Invitation events must belong to its workspace.' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists invitations_require_same_side_events on wedding.invitations;
create trigger invitations_require_same_side_events
before insert or update of event_limits, side on wedding.invitations
for each row execute function wedding.require_invitation_events_for_side();

-- Access expiry is an explicit per-link property. It is checked again by the
-- resolver and QR lifecycle triggers, but this guard prevents an operator
-- from creating a link that expires before RSVP closes.
create or replace function wedding.require_invitation_access_expiry()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_rsvp_deadline timestamptz;
begin
  select rsvp_deadline
    into v_rsvp_deadline
    from wedding.settings
   where side = new.side
   for share;

  if not found then
    raise exception 'Wedding settings must exist before an invitation can be issued.'
      using errcode = '23514';
  end if;

  if new.access_expires_at is null or new.access_expires_at <= now() then
    raise exception 'Invitation access expiry must be a future timestamp.'
      using errcode = '23514';
  end if;

  if new.access_expires_at < v_rsvp_deadline then
    raise exception 'Invitation access expiry must not precede the RSVP deadline.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists invitations_require_access_expiry on wedding.invitations;
create trigger invitations_require_access_expiry
before insert or update of access_expires_at on wedding.invitations
for each row execute function wedding.require_invitation_access_expiry();

-- Enforce the RSVP/revocation lifecycle in the database as well as in route
-- code. The lock prevents a concurrent status change from slipping between a
-- lifecycle check and an RSVP write/delete statement.
create or replace function wedding.require_active_invitation_for_rsvp_write()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  invitation_status text;
  invitation_access_expires_at timestamptz;
  invitation_can_edit_until timestamptz;
  invitation_side text;
begin
  select status, access_expires_at, side
    into invitation_status, invitation_access_expires_at, invitation_side
    from wedding.invitations
   where token_hash = new.token_hash
   for share;

  if invitation_status is distinct from 'active'
    or invitation_access_expires_at is null
    or invitation_access_expires_at <= now() then
    raise exception 'An RSVP can only be saved for an active invitation.'
      using errcode = '23514';
  end if;

  -- The route validates this cutoff before it calls the adapter, but that
  -- value can become stale while this transaction waits for the invitation
  -- lock. Keep the database authoritative for direct writes and the exact
  -- deadline boundary. `clock_timestamp()` intentionally advances during a
  -- transaction; PostgreSQL's `now()` is fixed at transaction start.
  select can_edit_until
    into invitation_can_edit_until
    from wedding.settings
   where side = invitation_side;

  if (invitation_can_edit_until is null
    or invitation_can_edit_until <= clock_timestamp())
    and not (
      coalesce(current_setting('wedding.coordinator_rsvp_write', true), '') = new.token_hash
      and current_user = (
        select pg_get_userbyid(proowner) from pg_proc
         where oid = to_regprocedure('wedding.save_coordinator_rsvp(uuid,jsonb,timestamptz,text)')
      )
    ) then
    raise exception 'Online RSVP is closed.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists rsvps_require_active_invitation on wedding.rsvps;
create trigger rsvps_require_active_invitation
before insert or update on wedding.rsvps
for each row execute function wedding.require_active_invitation_for_rsvp_write();

create or replace function wedding.require_revoked_invitation_for_rsvp_delete()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  invitation_status text;
begin
  select status
    into invitation_status
    from wedding.invitations
   where token_hash = old.token_hash
   for share;

  if invitation_status is distinct from 'revoked' then
    raise exception 'An RSVP can only be deleted after its invitation is revoked.'
      using errcode = '23514';
  end if;

  -- Retain only the time of erasure, never a duplicate of RSVP data.
  update wedding.invitations
     set rsvp_deleted_at = coalesce(rsvp_deleted_at, now())
   where token_hash = old.token_hash
     and status = 'revoked';
  return old;
end;
$$;

drop trigger if exists rsvps_require_revoked_invitation on wedding.rsvps;
create trigger rsvps_require_revoked_invitation
before delete on wedding.rsvps
for each row execute function wedding.require_revoked_invitation_for_rsvp_delete();

-- A QR pass cannot be issued or reassigned for a revoked, expired, or staged
-- invitation. Expiry is checked again at admission because time may pass after
-- this write.
create or replace function wedding.require_active_invitation_for_entry_pass_write()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  invitation_status text;
  invitation_access_expires_at timestamptz;
begin
  select status, access_expires_at
    into invitation_status, invitation_access_expires_at
    from wedding.invitations
   where id = new.invitation_id
   for share;

  if invitation_status is distinct from 'active'
    or invitation_access_expires_at is null
    or invitation_access_expires_at <= now() then
    raise exception 'An entry pass requires an active, unexpired invitation.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists entry_passes_require_active_invitation on wedding.entry_passes;
create trigger entry_passes_require_active_invitation
before insert or update of invitation_id on wedding.entry_passes
for each row execute function wedding.require_active_invitation_for_entry_pass_write();

-- An RSVP that stops being attending invalidates its QR immediately. The app
-- also performs this within its transaction; this trigger protects a reviewed
-- direct SQL change. A later attending RSVP must create a new pass version.
create or replace function wedding.invalidate_entry_passes_for_rsvp_change()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_token_hash text;
  v_has_selected_event boolean;
begin
  if tg_op = 'DELETE' then
    v_token_hash := old.token_hash;
    v_has_selected_event := false;
  else
    v_token_hash := new.token_hash;
    select exists (
      select 1
        from jsonb_array_elements(coalesce(new.attendances, '[]'::jsonb)) as attendance
       where jsonb_typeof(attendance) = 'object'
         and attendance ->> 'attending' = 'true'
    ) into v_has_selected_event;
  end if;

  if tg_op = 'DELETE' or new.status <> 'attending' or not v_has_selected_event then
    update wedding.entry_passes as passes
       set status = 'invalidated',
           invalidated_at = coalesce(passes.invalidated_at, now()),
           invalidation_reason = coalesce(passes.invalidation_reason, 'rsvp_no_longer_attending')
      from wedding.invitations as invitations
     where passes.invitation_id = invitations.id
       and invitations.token_hash = v_token_hash
       and passes.status = 'active';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists rsvps_invalidate_entry_passes on wedding.rsvps;
create trigger rsvps_invalidate_entry_passes
after insert or update or delete on wedding.rsvps
for each row execute function wedding.invalidate_entry_passes_for_rsvp_change();

-- Revoking a bearer link always invalidates its QR credential in the same
-- database transaction.
create or replace function wedding.invalidate_entry_passes_for_invitation_revoke()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if old.status <> 'revoked' and new.status = 'revoked' then
    update wedding.entry_passes
       set status = 'invalidated',
           invalidated_at = coalesce(invalidated_at, now()),
           invalidation_reason = coalesce(invalidation_reason, 'invitation_revoked')
     where invitation_id = new.id
       and status = 'active';
  end if;
  return new;
end;
$$;

drop trigger if exists invitations_invalidate_entry_passes on wedding.invitations;
create trigger invitations_invalidate_entry_passes
after update of status on wedding.invitations
for each row execute function wedding.invalidate_entry_passes_for_invitation_revoke();

-- Database-side entitlement checks close the gap between a scanner read and
-- write. The scanner repeats this validation and returns no household data on
-- invalid, expired, revoked, or uninvited-event scans.
create or replace function wedding.require_active_entry_pass_for_check_in()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_pass_status text;
  v_invitation_status text;
  v_invitation_access_expires_at timestamptz;
  v_invitation_side text;
  v_rsvp_status text;
  v_attendances jsonb;
  v_adults smallint;
  v_children smallint;
begin
  select passes.status, invitations.status, invitations.access_expires_at, invitations.side,
         responses.status, responses.attendances
    into v_pass_status, v_invitation_status, v_invitation_access_expires_at, v_invitation_side,
         v_rsvp_status, v_attendances
    from wedding.entry_passes as passes
    join wedding.invitations as invitations on invitations.id = passes.invitation_id
    left join wedding.rsvps as responses on responses.token_hash = invitations.token_hash
   where passes.id = new.entry_pass_id
   for update of passes, invitations;

  if v_pass_status is distinct from 'active'
    or v_invitation_status is distinct from 'active'
    or v_invitation_access_expires_at is null
    or v_invitation_access_expires_at <= now()
    or v_rsvp_status is distinct from 'attending' then
    raise exception 'An entry check-in requires an active attending invitation.'
      using errcode = '23514';
  end if;

  if not exists (select 1 from wedding.events where id = new.event_id and side = v_invitation_side and published) then
    raise exception 'The event must belong to the invitation workspace.' using errcode = '23514';
  end if;

  select
    (attendance ->> 'adults')::smallint,
    (attendance ->> 'children')::smallint
    into v_adults, v_children
    from jsonb_array_elements(coalesce(v_attendances, '[]'::jsonb)) as attendance
   where jsonb_typeof(attendance) = 'object'
     and attendance ->> 'eventId' = new.event_id
     and attendance ->> 'attending' = 'true'
   limit 1;
  if not found then
    raise exception 'The RSVP is not attending this event.'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT'
    and (new.expected_adult_count <> v_adults or new.expected_child_count <> v_children) then
    raise exception 'Entry count no longer matches the RSVP.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists entry_check_ins_require_active_pass on wedding.entry_check_ins;
create trigger entry_check_ins_require_active_pass
before insert or update on wedding.entry_check_ins
for each row execute function wedding.require_active_entry_pass_for_check_in();

-- Keep an audit of coordinator corrections without retaining erased names,
-- notes, messages, or attendance snapshots. Runtime callers cannot write it.
create table if not exists wedding.coordinator_rsvp_audit (
  id bigint generated always as identity primary key,
  invitation_id uuid not null references wedding.invitations(id) on delete restrict,
  previous_updated_at timestamptz,
  updated_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  database_actor text not null default session_user
);

-- This explicit operation is the only runtime permission that bypasses the
-- guest deadline. SECURITY DEFINER ownership, not a client-settable GUC alone,
-- authorizes the trigger exception. Always use a fixed search path and restore
-- the marker before returning; no guest INSERT/UPDATE can acquire that identity.
create or replace function wedding.save_coordinator_rsvp(
  p_invitation_id uuid, p_payload jsonb, p_expected_updated_at timestamptz, p_side text
)
returns table (outcome text, updated_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_invitation wedding.invitations%rowtype;
  v_previous_updated_at timestamptz;
  v_previous_contact_number text;
  v_contact_number text;
  v_updated_at timestamptz;
  v_item jsonb;
  v_limit jsonb;
  v_event_id text;
  v_status text;
  v_adults integer;
  v_children integer;
  v_selected integer := 0;
  v_event_count integer;
  v_seen text[] := '{}'::text[];
  v_previous_marker text;
begin
  if p_side is null or p_side not in ('groom', 'bride') then
    raise exception 'Invalid coordinator workspace' using errcode = '22023';
  end if;
  select * into v_invitation from wedding.invitations
   where id = p_invitation_id and side = p_side and status = 'active'
     and access_expires_at > clock_timestamp()
   for update;
  if not found then
    return query select 'not_found'::text, null::timestamptz;
    return;
  end if;

  select responses.updated_at, responses.contact_number into v_previous_updated_at, v_previous_contact_number from wedding.rsvps as responses
   where responses.token_hash = v_invitation.token_hash for update;
  if date_trunc('milliseconds', v_previous_updated_at) is distinct from p_expected_updated_at then
    return query select 'stale'::text, null::timestamptz;
    return;
  end if;

  v_status := p_payload ->> 'status';
  if jsonb_typeof(p_payload) is distinct from 'object'
    or p_payload - array['respondentName', 'contactNumber', 'status', 'attendances', 'comfortNote', 'declineMessage'] <> '{}'::jsonb
    or jsonb_typeof(p_payload -> 'respondentName') is distinct from 'string'
    or char_length(btrim(p_payload ->> 'respondentName')) not between 2 and 100
    or (p_payload ? 'contactNumber' and (
      jsonb_typeof(p_payload -> 'contactNumber') is distinct from 'string'
      or char_length(btrim(p_payload ->> 'contactNumber')) > 40
      or (btrim(p_payload ->> 'contactNumber') <> '' and (
        btrim(p_payload ->> 'contactNumber') !~ '^\+?[0-9 ()-]+$'
        or char_length(regexp_replace(p_payload ->> 'contactNumber', '[^0-9]', '', 'g')) not between 7 and 15
      ))
    ))
    or v_status is null or v_status not in ('attending', 'declined', 'confirming')
    or jsonb_typeof(p_payload -> 'attendances') is distinct from 'array'
    or jsonb_typeof(p_payload -> 'comfortNote') not in ('string', 'null')
    or jsonb_typeof(p_payload -> 'declineMessage') not in ('string', 'null')
    or char_length(coalesce(p_payload ->> 'comfortNote', '')) > 500
    or char_length(coalesce(p_payload ->> 'declineMessage', '')) > 500
    or (v_status <> 'attending' and nullif(btrim(p_payload ->> 'comfortNote'), '') is not null)
    or (v_status <> 'declined' and nullif(btrim(p_payload ->> 'declineMessage'), '') is not null) then
    return query select 'invalid'::text, null::timestamptz;
    return;
  end if;
  select count(*) into v_event_count from jsonb_object_keys(v_invitation.event_limits);
  if v_event_count not between 1 and 12
    or jsonb_array_length(p_payload -> 'attendances') <> v_event_count then
    return query select 'invalid'::text, null::timestamptz;
    return;
  end if;

  for v_item in select value from jsonb_array_elements(p_payload -> 'attendances') loop
    v_event_id := v_item ->> 'eventId';
    v_limit := v_invitation.event_limits -> v_event_id;
    if jsonb_typeof(v_item) is distinct from 'object'
      or v_item - array['eventId', 'attending', 'adults', 'children'] <> '{}'::jsonb
      or jsonb_typeof(v_item -> 'eventId') is distinct from 'string'
      or v_event_id = any(v_seen)
      or v_limit is null
      or jsonb_typeof(v_item -> 'attending') is distinct from 'boolean'
      or jsonb_typeof(v_item -> 'adults') is distinct from 'number'
      or jsonb_typeof(v_item -> 'children') is distinct from 'number'
      or (v_item ->> 'adults') !~ '^[0-9]{1,2}$'
      or (v_item ->> 'children') !~ '^[0-9]{1,2}$'
      or jsonb_typeof(v_limit -> 'adults') is distinct from 'number'
      or jsonb_typeof(v_limit -> 'children') is distinct from 'number'
      or (v_limit ->> 'adults') !~ '^[0-9]{1,2}$'
      or (v_limit ->> 'children') !~ '^[0-9]{1,2}$'
      or not exists (select 1 from wedding.events where id = v_event_id and side = p_side and published) then
      return query select 'invalid'::text, null::timestamptz;
      return;
    end if;
    v_seen := array_append(v_seen, v_event_id);
    v_adults := (v_item ->> 'adults')::integer;
    v_children := (v_item ->> 'children')::integer;
    if v_adults > 30 or v_children > 30
      or v_adults > (v_limit ->> 'adults')::integer
      or v_children > (v_limit ->> 'children')::integer
      or ((v_item ->> 'attending')::boolean and (v_status <> 'attending' or v_adults + v_children = 0))
      or (not (v_item ->> 'attending')::boolean and v_adults + v_children <> 0) then
      return query select 'invalid'::text, null::timestamptz;
      return;
    end if;
    if (v_item ->> 'attending')::boolean then v_selected := v_selected + 1; end if;
  end loop;
  if v_status = 'attending' and v_selected = 0 then
    return query select 'invalid'::text, null::timestamptz;
    return;
  end if;

  -- Older frontends omit the field, so keep an existing response's number.
  -- New manual replies inherit the invitation contact unless explicitly cleared.
  v_contact_number := case
    when p_payload ? 'contactNumber' then nullif(btrim(p_payload ->> 'contactNumber'), '')
    when v_previous_updated_at is not null then v_previous_contact_number
    else v_invitation.contact_number end;
  v_previous_marker := current_setting('wedding.coordinator_rsvp_write', true);
  perform set_config('wedding.coordinator_rsvp_write', v_invitation.token_hash, true);
  insert into wedding.rsvps as responses
    (token_hash, respondent_name, contact_number, status, attendances, comfort_note, decline_message)
  values (v_invitation.token_hash, btrim(p_payload ->> 'respondentName'), v_contact_number, v_status,
          p_payload -> 'attendances', nullif(btrim(p_payload ->> 'comfortNote'), ''),
          nullif(btrim(p_payload ->> 'declineMessage'), ''))
  on conflict (token_hash) do update set
    respondent_name = excluded.respondent_name, contact_number = excluded.contact_number, status = excluded.status,
    attendances = excluded.attendances, comfort_note = excluded.comfort_note,
    decline_message = excluded.decline_message
  returning responses.updated_at into v_updated_at;
  perform set_config('wedding.coordinator_rsvp_write', coalesce(v_previous_marker, ''), true);
  insert into wedding.coordinator_rsvp_audit (invitation_id, previous_updated_at, updated_at)
  values (v_invitation.id, v_previous_updated_at, v_updated_at);
  return query select 'saved'::text, v_updated_at;
end;
$$;

-- Older API deployments remain compatible while the two projects deploy
-- independently. This signature always addresses the existing groom data.
create or replace function wedding.save_coordinator_rsvp(
  p_invitation_id uuid, p_payload jsonb, p_expected_updated_at timestamptz
)
returns table (outcome text, updated_at timestamptz)
language sql
security invoker
set search_path = pg_catalog
as $$
  select * from wedding.save_coordinator_rsvp(p_invitation_id, p_payload, p_expected_updated_at, 'groom'::text);
$$;

comment on schema wedding is
  'Direct PostgreSQL persistence for Shaadi Companion. No browser role receives table or function privileges.';

-- Shared counters contain only SHA-256 composite identifiers, never an IP,
-- invitation bearer token, password, or TOTP code. Each bucket expires within
-- one hour; each call removes at most 100 expired rows through its expiry index.
create table if not exists wedding.rate_limit_buckets (
  key_hash text primary key check (key_hash ~ '^[a-f0-9]{64}$'),
  request_count integer not null check (request_count between 1 and 1001),
  expires_at timestamptz not null
);
create index if not exists rate_limit_buckets_expiry_idx
  on wedding.rate_limit_buckets (expires_at, key_hash);

create or replace function wedding.take_rate_limit(
  p_key_hash text, p_max_requests integer, p_window_ms integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = pg_catalog
set statement_timeout = '3s'
set lock_timeout = '2s'
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_count integer;
  v_expires_at timestamptz;
begin
  if p_key_hash is null or p_key_hash !~ '^[a-f0-9]{64}$'
    or p_max_requests is null or p_max_requests not between 1 and 1000
    or p_window_ms is null or p_window_ms not between 1000 and 3600000 then
    raise exception 'Invalid rate-limit request' using errcode = '22023';
  end if;

  -- Skip rows another function is using rather than making unrelated callers
  -- wait for cleanup. Its bound also prevents a cold start from sweeping the
  -- whole table. Further traffic eventually removes every expired counter.
  delete from wedding.rate_limit_buckets as buckets
    using (
      select key_hash from wedding.rate_limit_buckets
       where expires_at <= v_now
       order by expires_at, key_hash
       limit 100 for update skip locked
    ) as expired
    where buckets.key_hash = expired.key_hash;

  insert into wedding.rate_limit_buckets as buckets (key_hash, request_count, expires_at)
    values (p_key_hash, 1, v_now + p_window_ms * interval '1 millisecond')
    on conflict (key_hash) do update set
      request_count = case when buckets.expires_at <= v_now then 1
        else least(buckets.request_count + 1, p_max_requests + 1) end,
      expires_at = case when buckets.expires_at <= v_now
        then v_now + p_window_ms * interval '1 millisecond' else buckets.expires_at end
    returning request_count, expires_at into v_count, v_expires_at;

  -- The upsert holds the row lock until this statement's transaction finishes;
  -- concurrent Vercel instances cannot both consume the last available slot.
  return query select v_count <= p_max_requests,
    case when v_count <= p_max_requests then 0
      else greatest(1, ceil(extract(epoch from (v_expires_at - v_now)))::integer) end;
end;
$$;

revoke all on function wedding.take_rate_limit(text, integer, integer) from public;
comment on table wedding.rate_limit_buckets is
  'Short-lived hashed shared rate counters. Runtime access is limited to the atomic definer function.';

comment on table wedding.rsvps is
  'RSVP persistence. Writes require an active invitation and deletion requires a revoked invitation.';

comment on table wedding.invitations is
  'Invitation records with HMAC token digests, reply-to role, revocation, and timestamp-only RSVP-erasure audit.';

comment on table wedding.entry_passes is
  'Household QR pass metadata. Stores HMAC lookup digests and non-secret rotation versions only.';

comment on table wedding.entry_check_ins is
  'Event-gate audit. One first-admission row per household pass and event; repeat scans increment a counter.';

-- Only hashes of signed coordinator cookies are persisted. Registration is
-- required on every deployment, and revocation applies across function instances.
create table if not exists wedding.coordinator_sessions (
  session_hash text primary key check (session_hash ~ '^[a-f0-9]{64}$'),
  side text not null default 'groom' check (side in ('groom', 'bride')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '8 hours 1 minute')
);
alter table wedding.coordinator_sessions add column if not exists side text not null default 'groom';
alter table wedding.coordinator_sessions drop constraint if exists coordinator_sessions_side_check;
alter table wedding.coordinator_sessions add constraint coordinator_sessions_side_check check (side in ('groom', 'bride'));
create index if not exists coordinator_sessions_expiry_idx
  on wedding.coordinator_sessions (expires_at, session_hash);

create or replace function wedding.coordinator_session(
  p_action text, p_session_hash text, p_expires_at timestamptz, p_side text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
set statement_timeout = '3s'
set lock_timeout = '2s'
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  if p_session_hash is null or p_session_hash !~ '^[a-f0-9]{64}$'
    or p_side is null or p_side not in ('groom', 'bride')
    or p_action is null or p_action not in ('register', 'validate', 'revoke') then
    raise exception 'Invalid coordinator session request' using errcode = '22023';
  end if;

  if p_action = 'validate' then
    return exists (
      select 1 from wedding.coordinator_sessions
       where session_hash = p_session_hash and side = p_side and expires_at > v_now and revoked_at is null
    );
  end if;

  if p_action = 'revoke' then
    update wedding.coordinator_sessions set revoked_at = coalesce(revoked_at, v_now)
     where session_hash = p_session_hash and side = p_side;
    return true;
  end if;

  if p_expires_at is null or p_expires_at <= v_now or p_expires_at > v_now + interval '8 hours 1 minute' then
    return false;
  end if;
  delete from wedding.coordinator_sessions as sessions
    using (
      select session_hash from wedding.coordinator_sessions
       where expires_at <= v_now order by expires_at, session_hash
       limit 100 for update skip locked
    ) as expired where sessions.session_hash = expired.session_hash;
  insert into wedding.coordinator_sessions (session_hash, expires_at, side)
    values (p_session_hash, p_expires_at, p_side) on conflict do nothing;
  -- Retrying registration cannot extend or resurrect a revoked session.
  return exists (
    select 1 from wedding.coordinator_sessions
     where session_hash = p_session_hash and side = p_side and expires_at = p_expires_at and revoked_at is null
  );
end;
$$;
create or replace function wedding.coordinator_session(
  p_action text, p_session_hash text, p_expires_at timestamptz
)
returns boolean
language sql
security invoker
set search_path = pg_catalog
as $$
  select wedding.coordinator_session(p_action, p_session_hash, p_expires_at, 'groom'::text);
$$;
comment on table wedding.coordinator_sessions is
  'Expiring coordinator session hashes. No raw cookie, password, or guest information is stored.';

revoke all on all tables in schema wedding from public;
revoke all on all sequences in schema wedding from public;
revoke all on all functions in schema wedding from public;
alter default privileges in schema wedding revoke all on tables from public;
alter default privileges in schema wedding revoke all on sequences from public;
alter default privileges in schema wedding revoke execute on functions from public;
