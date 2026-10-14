-- Synthetic configuration for the disposable Docker Compose integration database.
-- This file is never used by the application or production schema workflow.

insert into wedding.settings (
  id,
  couple_names_en, couple_names_hi,
  wedding_date_en, wedding_date_hi,
  location_en, location_hi,
  wedding_moment, rsvp_deadline, can_edit_until,
  coordinator_name, coordinator_phone
) values (
  1,
  'Test Couple', 'परीक्षण युगल',
  'Test date', 'परीक्षण तिथि',
  'Test venue', 'परीक्षण स्थल',
  now() + interval '30 days',
  now() + interval '14 days',
  now() + interval '7 days',
  'Test Coordinator', '9876543210'
);

insert into wedding.events (
  id, slug,
  title_en, title_hi,
  date_en, date_hi,
  start_time_en, start_time_hi,
  arrival_window_en, arrival_window_hi,
  start_at, end_at,
  venue_en, venue_hi,
  address_en, address_hi,
  maps_url,
  entry_note_en, entry_note_hi,
  dress_code_en, dress_code_hi,
  practical_note_en, practical_note_hi,
  category, published, display_order,
  default_selected, default_adult_limit, default_child_limit
) values (
  'test-event', 'test-event',
  'Test event', 'परीक्षण कार्यक्रम',
  'Test date', 'परीक्षण तिथि',
  '12:00', '12:00',
  'Test arrival window', 'परीक्षण आगमन समय',
  now() + interval '30 days', now() + interval '30 days 2 hours',
  'Test venue', 'परीक्षण स्थल',
  'Test address', 'परीक्षण पता',
  'https://example.test/test-event',
  'Test entry note', 'परीक्षण प्रवेश सूचना',
  'Test dress code', 'परीक्षण पहनावा',
  'Test practical note', 'परीक्षण जानकारी',
  'celebration', true, 1,
  true, 2, 0
);
