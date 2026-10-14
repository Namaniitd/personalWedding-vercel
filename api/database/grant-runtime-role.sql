-- Run with psql as the owner of the wedding schema after applying schema.sql:
--   psql "$DATABASE_SCHEMA_URL" -v ON_ERROR_STOP=1 -v runtime_role=shaadi_app \
--     -f database/grant-runtime-role.sql
-- The login role and its password are provisioned separately by the operator.
-- The :"runtime_role" form quotes a psql variable as one SQL identifier.

\set ON_ERROR_STOP on
begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';

select set_config('shaadi.runtime_role', :'runtime_role', true);

do $$
declare
  v_runtime_role text := current_setting('shaadi.runtime_role');
  v_schema_owner text;
  v_role pg_roles%rowtype;
begin
  if v_runtime_role !~ '^[a-z_][a-z0-9_]{0,62}$' then
    raise exception 'runtime_role must be a simple PostgreSQL role name';
  end if;

  select pg_get_userbyid(nspowner) into v_schema_owner
    from pg_namespace where nspname = 'wedding';
  if v_schema_owner is null or v_schema_owner <> current_user then
    raise exception 'Connect as the owner of the wedding schema before granting runtime access';
  end if;
  if (select pg_get_userbyid(proowner) from pg_proc
       where oid = 'wedding.save_coordinator_rsvp(uuid,jsonb,timestamptz)'::regprocedure)
     is distinct from v_schema_owner then
    raise exception 'The coordinator RSVP function must be owned by the wedding schema owner';
  end if;
  if (select pg_get_userbyid(proowner) from pg_proc
       where oid = 'wedding.take_rate_limit(text,integer,integer)'::regprocedure)
     is distinct from v_schema_owner then
    raise exception 'The shared rate-limit function must be owned by the wedding schema owner';
  end if;
  if (select pg_get_userbyid(proowner) from pg_proc
       where oid = 'wedding.coordinator_session(text,text,timestamptz)'::regprocedure)
     is distinct from v_schema_owner then
    raise exception 'The coordinator session function must be owned by the wedding schema owner';
  end if;

  select * into v_role from pg_roles where rolname = v_runtime_role;
  if not found then
    raise exception 'The runtime login role does not exist';
  end if;
  if not v_role.rolcanlogin
    or v_role.rolsuper
    or v_role.rolcreatedb
    or v_role.rolcreaterole
    or v_role.rolreplication
    or v_role.rolbypassrls
    or v_runtime_role = v_schema_owner
    or pg_has_role(v_runtime_role, v_schema_owner, 'member') then
    raise exception 'The runtime role must be a separate, non-admin login without schema-owner membership';
  end if;
end;
$$;

-- Re-running this file replaces previous direct grants instead of accumulating
-- permissions. Existing inherited privileges are checked below as well.
revoke all privileges on schema wedding from :"runtime_role";
revoke all privileges on all tables in schema wedding from :"runtime_role";
revoke all privileges on all sequences in schema wedding from :"runtime_role";
revoke all privileges on all functions in schema wedding from :"runtime_role";
alter default privileges in schema wedding revoke all on tables from :"runtime_role";
alter default privileges in schema wedding revoke all on sequences from :"runtime_role";
alter default privileges in schema wedding revoke all on functions from :"runtime_role";

grant usage on schema wedding to :"runtime_role";

-- The content editor owns the complete settings, contact, and event snapshots.
-- It never deletes those records, so the role has no DELETE or TRUNCATE grant.
grant select, insert, update on wedding.settings, wedding.contacts, wedding.events
  to :"runtime_role";

-- The invitation link is returned once. The legacy token_ciphertext column is
-- never selected or written by this API and receives no runtime privilege.
grant select (
  id, lock_marker, token_hash, household_name_en, household_name_hi,
  preferred_locale, contact_role, event_limits, status, access_expires_at,
  revoked_at, rsvp_deleted_at, created_at
) on wedding.invitations to :"runtime_role";
grant insert (
  id, token_hash, household_name_en, household_name_hi, preferred_locale,
  contact_role, event_limits, access_expires_at
) on wedding.invitations to :"runtime_role";
grant update (lock_marker, status, revoked_at, rsvp_deleted_at)
  on wedding.invitations to :"runtime_role";

grant select on wedding.rsvps to :"runtime_role";
grant insert (token_hash, respondent_name, status, attendances, comfort_note, decline_message)
  on wedding.rsvps to :"runtime_role";
grant update (respondent_name, status, attendances, comfort_note, decline_message, updated_at)
  on wedding.rsvps to :"runtime_role";
grant delete on wedding.rsvps to :"runtime_role";
-- Execute only the explicit audited coordinator operation. Its definer owns
-- the cutoff exception and audit table; ordinary guest writes retain the trigger.
grant execute on function wedding.save_coordinator_rsvp(uuid, jsonb, timestamptz)
  to :"runtime_role";
-- The API can consume hashed counters without reading, changing, deleting, or
-- manufacturing bucket rows. The frontend has no PostgreSQL credentials.
grant execute on function wedding.take_rate_limit(text, integer, integer)
  to :"runtime_role";
grant execute on function wedding.coordinator_session(text, text, timestamptz)
  to :"runtime_role";

grant select on wedding.entry_passes to :"runtime_role";
grant insert (id, invitation_id, token_hash, pass_version, status)
  on wedding.entry_passes to :"runtime_role";
grant update (status, invalidated_at, invalidation_reason)
  on wedding.entry_passes to :"runtime_role";

grant select on wedding.entry_check_ins to :"runtime_role";
grant insert (id, entry_pass_id, event_id, expected_adult_count, expected_child_count)
  on wedding.entry_check_ins to :"runtime_role";
grant update (last_scanned_at, scan_count)
  on wedding.entry_check_ins to :"runtime_role";

do $$
declare
  v_runtime_role text := current_setting('shaadi.runtime_role');
begin
  if has_database_privilege(v_runtime_role, current_database(), 'CREATE')
    or exists (
      select 1 from pg_namespace as namespaces
       where namespaces.nspname <> 'information_schema'
         and namespaces.nspname not like 'pg_%'
         and has_schema_privilege(v_runtime_role, namespaces.nspname, 'CREATE')
    )
    or has_column_privilege(v_runtime_role, 'wedding.invitations', 'token_ciphertext', 'SELECT')
    or has_column_privilege(v_runtime_role, 'wedding.invitations', 'token_ciphertext', 'INSERT')
    or has_table_privilege(v_runtime_role, 'wedding.invitations', 'DELETE')
    or has_table_privilege(v_runtime_role, 'wedding.entry_passes', 'DELETE')
    or has_table_privilege(v_runtime_role, 'wedding.entry_check_ins', 'DELETE')
    or has_table_privilege(v_runtime_role, 'wedding.settings', 'DELETE')
    or has_table_privilege(v_runtime_role, 'wedding.contacts', 'DELETE')
    or has_table_privilege(v_runtime_role, 'wedding.events', 'DELETE')
    or has_table_privilege(v_runtime_role, 'wedding.coordinator_rsvp_audit', 'INSERT')
    or has_table_privilege(v_runtime_role, 'wedding.coordinator_rsvp_audit', 'UPDATE')
    or has_table_privilege(v_runtime_role, 'wedding.coordinator_rsvp_audit', 'DELETE')
    or has_table_privilege(v_runtime_role, 'wedding.coordinator_rsvp_audit', 'TRUNCATE')
    or has_table_privilege(v_runtime_role, 'wedding.rate_limit_buckets', 'SELECT')
    or has_table_privilege(v_runtime_role, 'wedding.rate_limit_buckets', 'INSERT')
    or has_table_privilege(v_runtime_role, 'wedding.rate_limit_buckets', 'UPDATE')
    or has_table_privilege(v_runtime_role, 'wedding.rate_limit_buckets', 'DELETE')
    or has_table_privilege(v_runtime_role, 'wedding.rate_limit_buckets', 'TRUNCATE')
    or has_table_privilege(v_runtime_role, 'wedding.coordinator_sessions', 'SELECT')
    or has_table_privilege(v_runtime_role, 'wedding.coordinator_sessions', 'INSERT')
    or has_table_privilege(v_runtime_role, 'wedding.coordinator_sessions', 'UPDATE')
    or has_table_privilege(v_runtime_role, 'wedding.coordinator_sessions', 'DELETE')
    or has_table_privilege(v_runtime_role, 'wedding.coordinator_sessions', 'TRUNCATE')
    or has_table_privilege(v_runtime_role, 'wedding.rsvps', 'TRUNCATE') then
    raise exception 'The runtime role inherits or retains privileges outside the reviewed API grants';
  end if;
end;
$$;

commit;
