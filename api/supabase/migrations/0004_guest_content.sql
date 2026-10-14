-- Public invitation presentation content. Apply after the existing Shaadi
-- Companion migrations, populate real content, then deploy the DB-only app.
-- No names, URLs, or wedding details belong in this migration.

alter table public.wedding_settings
  add column if not exists guest_content jsonb;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'wedding_settings_guest_content_object_check'
       and conrelid = 'public.wedding_settings'::regclass
  ) then
    alter table public.wedding_settings
      add constraint wedding_settings_guest_content_object_check
      check (guest_content is null or jsonb_typeof(guest_content) = 'object');
  end if;
end;
$$;

-- Ordering remains nullable for a staged rollout. The server uses start time
-- and ID as deterministic fallbacks until every hosted event has a value.
alter table public.events
  add column if not exists display_order smallint;
