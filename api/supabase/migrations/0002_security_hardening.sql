-- Apply after 0001_shaadi_companion.sql when upgrading a project created before
-- the security hardening. Fresh projects should apply both migrations in order.

alter table public.invitations add column if not exists access_expires_at timestamptz;
update public.invitations
set access_expires_at = rsvp_deadline + interval '90 days'
where access_expires_at is null;
alter table public.invitations alter column access_expires_at set not null;
alter table public.invitations alter column token_hash type text using btrim(token_hash);
alter table public.invitations drop constraint if exists invitations_token_hash_hex_check;
alter table public.invitations add constraint invitations_token_hash_hex_check check (token_hash ~ '^[0-9a-f]{64}$');
alter table public.invitations drop constraint if exists invitations_access_expiry_after_rsvp_check;
alter table public.invitations add constraint invitations_access_expiry_after_rsvp_check check (access_expires_at >= rsvp_deadline);
alter table public.rsvps add column if not exists decline_message text;
alter table public.rsvps drop constraint if exists rsvps_decline_message_length_check;
alter table public.rsvps add constraint rsvps_decline_message_length_check check (char_length(decline_message) <= 500);
alter table public.rsvps drop constraint if exists rsvps_decline_message_status_check;
alter table public.rsvps add constraint rsvps_decline_message_status_check check (status = 'declined' or decline_message is null);
alter table public.coordinator_activity drop constraint if exists coordinator_activity_action_length_check;
alter table public.coordinator_activity add constraint coordinator_activity_action_length_check check (char_length(action) between 1 and 80);

-- Do not let cascade deletes erase RSVP or coordinator history.
alter table public.rsvps drop constraint if exists rsvps_invitation_id_fkey;
alter table public.rsvps add constraint rsvps_invitation_id_fkey foreign key (invitation_id) references public.invitations(id) on delete restrict;
alter table public.rsvp_revisions drop constraint if exists rsvp_revisions_rsvp_id_fkey;
alter table public.rsvp_revisions add constraint rsvp_revisions_rsvp_id_fkey foreign key (rsvp_id) references public.rsvps(id) on delete restrict;
alter table public.rsvp_event_attendance drop constraint if exists rsvp_event_attendance_event_id_fkey;
alter table public.rsvp_event_attendance add constraint rsvp_event_attendance_event_id_fkey foreign key (event_id) references public.events(id) on delete restrict;
alter table public.logistics_requests drop constraint if exists logistics_requests_invitation_id_fkey;
alter table public.logistics_requests add constraint logistics_requests_invitation_id_fkey foreign key (invitation_id) references public.invitations(id) on delete restrict;
alter table public.coordinator_activity drop constraint if exists coordinator_activity_invitation_id_fkey;
alter table public.coordinator_activity add constraint coordinator_activity_invitation_id_fkey foreign key (invitation_id) references public.invitations(id) on delete restrict;

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

create or replace function public.is_wedding_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select public.has_wedding_role(array['owner', 'rsvp', 'hospitality', 'content']::public.coordinator_role[]);
$$;

create or replace function public.is_wedding_owner()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select public.has_wedding_role(array['owner']::public.coordinator_role[]);
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.has_wedding_role(public.coordinator_role[]) from public, anon, authenticated;
revoke all on function public.is_wedding_admin() from public, anon, authenticated;
revoke all on function public.is_wedding_owner() from public, anon, authenticated;
grant execute on function public.has_wedding_role(public.coordinator_role[]) to authenticated;
grant execute on function public.is_wedding_admin() to authenticated;
grant execute on function public.is_wedding_owner() to authenticated;

drop policy if exists "admins manage settings" on public.wedding_settings;
drop policy if exists "admins manage events" on public.events;
drop policy if exists "admins manage invitations" on public.invitations;
drop policy if exists "admins manage invitation events" on public.invitation_events;
drop policy if exists "admins manage rsvps" on public.rsvps;
drop policy if exists "admins manage attendance" on public.rsvp_event_attendance;
drop policy if exists "admins manage logistics" on public.logistics_requests;
drop policy if exists "admins read revisions" on public.rsvp_revisions;
drop policy if exists "admins manage activity" on public.coordinator_activity;
drop policy if exists "owners manage roles" on public.admin_roles;
drop policy if exists "coordinators read settings" on public.wedding_settings;
drop policy if exists "owners and content add settings" on public.wedding_settings;
drop policy if exists "owners and content update settings" on public.wedding_settings;
drop policy if exists "coordinators read events" on public.events;
drop policy if exists "owners and content add events" on public.events;
drop policy if exists "owners and content update events" on public.events;
drop policy if exists "owners manage invitations" on public.invitations;
drop policy if exists "rsvp team reads invitations" on public.invitations;
drop policy if exists "owners add invitations" on public.invitations;
drop policy if exists "owners update invitations" on public.invitations;
drop policy if exists "owners read invitation events" on public.invitation_events;
drop policy if exists "rsvp team reads invitation events" on public.invitation_events;
drop policy if exists "owners add invitation events" on public.invitation_events;
drop policy if exists "owners update invitation events" on public.invitation_events;
drop policy if exists "rsvp team reads rsvps" on public.rsvps;
drop policy if exists "rsvp team adds rsvps" on public.rsvps;
drop policy if exists "rsvp team updates rsvps" on public.rsvps;
drop policy if exists "rsvp team reads attendance" on public.rsvp_event_attendance;
drop policy if exists "rsvp team adds attendance" on public.rsvp_event_attendance;
drop policy if exists "rsvp team updates attendance" on public.rsvp_event_attendance;
drop policy if exists "hospitality team reads logistics" on public.logistics_requests;
drop policy if exists "hospitality team adds logistics" on public.logistics_requests;
drop policy if exists "hospitality team updates logistics" on public.logistics_requests;
drop policy if exists "rsvp team reads revisions" on public.rsvp_revisions;
drop policy if exists "rsvp team reads activity" on public.coordinator_activity;
drop policy if exists "rsvp team adds activity" on public.coordinator_activity;

create policy "coordinators read settings" on public.wedding_settings for select to authenticated using (public.is_wedding_admin());
create policy "owners and content add settings" on public.wedding_settings for insert to authenticated with check (public.has_wedding_role(array['owner', 'content']::public.coordinator_role[]));
create policy "owners and content update settings" on public.wedding_settings for update to authenticated using (public.has_wedding_role(array['owner', 'content']::public.coordinator_role[])) with check (public.has_wedding_role(array['owner', 'content']::public.coordinator_role[]));

create policy "coordinators read events" on public.events for select to authenticated using (public.is_wedding_admin());
create policy "owners and content add events" on public.events for insert to authenticated with check (public.has_wedding_role(array['owner', 'content']::public.coordinator_role[]));
create policy "owners and content update events" on public.events for update to authenticated using (public.has_wedding_role(array['owner', 'content']::public.coordinator_role[])) with check (public.has_wedding_role(array['owner', 'content']::public.coordinator_role[]));

create policy "rsvp team reads invitations" on public.invitations for select to authenticated using (public.has_wedding_role(array['owner', 'rsvp']::public.coordinator_role[]));
create policy "owners add invitations" on public.invitations for insert to authenticated with check (public.has_wedding_role(array['owner']::public.coordinator_role[]));
create policy "owners update invitations" on public.invitations for update to authenticated using (public.has_wedding_role(array['owner']::public.coordinator_role[])) with check (public.has_wedding_role(array['owner']::public.coordinator_role[]));

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

drop trigger if exists rsvps_confirmation_actor on public.rsvps;
drop trigger if exists rsvps_status_guard on public.rsvps;
drop trigger if exists rsvps_coordinator_audit on public.rsvps;
drop trigger if exists attendance_limit_guard on public.rsvp_event_attendance;
drop trigger if exists attendance_coordinator_audit on public.rsvp_event_attendance;
drop trigger if exists coordinator_activity_actor on public.coordinator_activity;
drop trigger if exists rsvp_revisions_append_only on public.rsvp_revisions;
drop trigger if exists coordinator_activity_append_only on public.coordinator_activity;
create trigger rsvps_confirmation_actor before insert or update on public.rsvps for each row execute function public.set_rsvp_confirmation_actor();
create trigger rsvps_status_guard before insert or update on public.rsvps for each row execute function public.enforce_coordinator_rsvp_status();
create trigger rsvps_coordinator_audit after insert or update on public.rsvps for each row execute function public.audit_coordinator_rsvp_change();
create trigger attendance_limit_guard before insert or update on public.rsvp_event_attendance for each row execute function public.enforce_coordinator_attendance_limit();
create trigger attendance_coordinator_audit after insert or update on public.rsvp_event_attendance for each row execute function public.audit_coordinator_attendance_change();
create trigger coordinator_activity_actor before insert on public.coordinator_activity for each row execute function public.set_activity_actor();
create trigger rsvp_revisions_append_only before update or delete on public.rsvp_revisions for each row execute function public.prevent_audit_mutation();
create trigger coordinator_activity_append_only before update or delete on public.coordinator_activity for each row execute function public.prevent_audit_mutation();

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
