-- Invitation allocations must give each invited event at least one guest.
--
-- `NOT VALID` makes this safe for an already-running project: PostgreSQL
-- enforces the rule for every new or changed row, but this migration neither
-- rewrites existing household data nor fails because an operator needs to
-- review a historic zero-allocation row. Remediate any such rows deliberately,
-- then validate this constraint in a separately reviewed maintenance change.
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'invitation_events_positive_guest_limit_check'
       and conrelid = 'public.invitation_events'::regclass
  ) then
    alter table public.invitation_events
      add constraint invitation_events_positive_guest_limit_check
      check (adult_limit + child_limit > 0) not valid;
  end if;
end;
$$;

-- Existing hosted projects have already applied the earlier function definition,
-- so replace it here as well. This gives imports a stable, intentional P0001
-- validation error rather than relying only on the table constraint.
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
