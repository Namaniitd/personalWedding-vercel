-- Local wedding content for Naman & Neha.
--
-- This file holds REAL wedding details, so it is gitignored (`*.local.sql`).
-- Never commit it, and never copy it into `database/test-fixtures.sql`.
--
-- Re-run it any time with:
--   pnpm content:apply
--
-- Values marked "PLACEHOLDER" below were not supplied and must be replaced
-- before this invitation is shared with any guest.
--
-- Phone numbers must be real Indian mobiles: 10 digits starting with 6-9.
-- The app validates them (^91[6-9]\d{9}$) and refuses to render the whole
-- invitation if any active contact number is malformed.

begin;

-- ---------------------------------------------------------------------------
-- Wedding settings
-- ---------------------------------------------------------------------------
insert into wedding.settings (
  id,
  couple_names_en, couple_names_hi,
  wedding_date_en, wedding_date_hi,
  location_en, location_hi,
  wedding_moment, rsvp_deadline, can_edit_until,
  coordinator_name, coordinator_phone,
  guest_content
) values (
  1,
  'Naman & Neha', 'नमन एवं नेहा',
  'Tuesday, 24 November 2026', 'मंगलवार, २४ नवम्बर २०२६',
  'Rewari, Haryana', 'रेवाड़ी, हरियाणा',
  '2026-11-24T19:00:00+05:30',   -- wedding_moment: Vivah muhurat (PLACEHOLDER time)
  '2026-11-10T23:59:00+05:30',   -- rsvp_deadline: last date to reply
  '2026-11-10T23:59:00+05:30',   -- can_edit_until: must be <= rsvp_deadline
  'Naman',                       -- coordinator_name
  '9000000000',                  -- PLACEHOLDER coordinator_phone (see note below)
  jsonb_build_object(
    'hero', jsonb_build_object('artworkKey', 'ganesha-basohli'),
    'travel', jsonb_build_object(
      'title', jsonb_build_object('en', 'Getting to Rewari', 'hi', 'रेवाड़ी कैसे पहुँचें'),
      'lead', jsonb_build_object(
        'en', 'A few practical notes to help you plan your journey.',
        'hi', 'आपकी यात्रा की योजना के लिए कुछ उपयोगी जानकारी।'
      ),
      'cards', jsonb_build_array(
        jsonb_build_object(
          'icon', 'train',
          'title', jsonb_build_object('en', 'By train', 'hi', 'रेल मार्ग'),
          'body', jsonb_build_object(
            'en', 'Rewari Junction is a major stop with direct trains from Delhi and Jaipur.',
            'hi', 'रेवाड़ी जंक्शन एक प्रमुख स्टेशन है, दिल्ली और जयपुर से सीधी रेलगाड़ियाँ उपलब्ध हैं।'
          )
        ),
        jsonb_build_object(
          'icon', 'plane',
          'title', jsonb_build_object('en', 'By air', 'hi', 'हवाई मार्ग'),
          'body', jsonb_build_object(
            'en', 'Delhi IGI Airport is the nearest airport, roughly two hours away by road.',
            'hi', 'निकटतम हवाई अड्डा दिल्ली आईजीआई है, सड़क मार्ग से लगभग दो घंटे।'
          )
        ),
        jsonb_build_object(
          'icon', 'bed',
          'title', jsonb_build_object('en', 'Where to stay', 'hi', 'कहाँ ठहरें'),
          'body', jsonb_build_object(
            'en', 'Please call us and we will help arrange rooms for your family.',
            'hi', 'कृपया हमें फ़ोन करें, हम आपके परिवार के ठहरने की व्यवस्था में सहायता करेंगे।'
          )
        )
      )
    ),
    'blessings', jsonb_build_object(
      'invocation', '॥ श्री गणेशाय नमः ॥',
      'title', jsonb_build_object('en', 'Blessings for the couple', 'hi', 'वर-वधू के लिए आशीर्वाद'),
      'cards', jsonb_build_array(
        jsonb_build_object(
          'artworkKey', 'ganesha-basohli',
          'label', jsonb_build_object('en', 'Shri Ganesha', 'hi', 'श्री गणेश'),
          'artworkAlt', jsonb_build_object(
            'en', 'Basohli miniature painting of Ganesha.',
            'hi', 'गणेश की बसोहली लघुचित्रकला।'
          ),
          'sanskrit', E'वक्रतुण्ड महाकाय\nसूर्यकोटि समप्रभ',
          'translation', jsonb_build_object(
            'en', 'May all obstacles be removed from this union.',
            'hi', 'इस मिलन से सभी विघ्न दूर हों।'
          ),
          'citation', 'Ganapati Atharvashirsha'
        ),
        jsonb_build_object(
          'artworkKey', 'gaja-lakshmi',
          'label', jsonb_build_object('en', 'Gaja Lakshmi', 'hi', 'गजलक्ष्मी'),
          'artworkAlt', jsonb_build_object(
            'en', 'Gaja Lakshmi seated on a lotus.',
            'hi', 'कमल पर विराजमान गजलक्ष्मी।'
          ),
          'sanskrit', E'या देवी सर्वभूतेषु\nलक्ष्मीरूपेण संस्थिता',
          'translation', jsonb_build_object(
            'en', 'May prosperity and grace abide with them always.',
            'hi', 'उन पर सदा समृद्धि और कृपा बनी रहे।'
          ),
          'citation', 'Devi Mahatmyam'
        )
      )
    )
  )
) on conflict (id) do update set
  couple_names_en = excluded.couple_names_en,
  couple_names_hi = excluded.couple_names_hi,
  wedding_date_en = excluded.wedding_date_en,
  wedding_date_hi = excluded.wedding_date_hi,
  location_en = excluded.location_en,
  location_hi = excluded.location_hi,
  wedding_moment = excluded.wedding_moment,
  rsvp_deadline = excluded.rsvp_deadline,
  can_edit_until = excluded.can_edit_until,
  coordinator_name = excluded.coordinator_name,
  coordinator_phone = excluded.coordinator_phone,
  guest_content = excluded.guest_content,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- Reply-to contacts (shown on the invitation the guest receives)
-- ---------------------------------------------------------------------------
insert into wedding.contacts (role, name, phone, is_active) values
  ('groom', 'Naman', '9000000000', true),   -- PLACEHOLDER phone
  ('bride', 'Neha',  '9000000000', true)    -- PLACEHOLDER phone
on conflict (role) do update set
  name = excluded.name,
  phone = excluded.phone,
  is_active = excluded.is_active,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- Celebrations
-- Times and venue addresses are PLACEHOLDERS unless noted. Update them in the
-- coordinator Content workspace before issuing guest invitations.
-- ---------------------------------------------------------------------------
-- A currently active test invitation in this local database references
-- `test-event`. Do not remove it while that private link is live; a fresh
-- database (or one without such a link) can clear it safely.
delete from wedding.events
where id = 'test-event'
  and not exists (
    select 1
    from wedding.invitations
    where status = 'active'
      and access_expires_at > now()
      and event_limits ? 'test-event'
  )
  and not exists (
    select 1
    from wedding.entry_check_ins
    where event_id = 'test-event'
  );

insert into wedding.events (
  id, slug, title_en, title_hi, date_en, date_hi,
  start_time_en, start_time_hi, arrival_window_en, arrival_window_hi,
  start_at, end_at, venue_en, venue_hi, address_en, address_hi, maps_url,
  entry_note_en, entry_note_hi, dress_code_en, dress_code_hi,
  practical_note_en, practical_note_hi,
  category, published, display_order, default_selected,
  default_adult_limit, default_child_limit
) values
  (
    'lagan', 'lagan', 'Lagan', 'लगन',
    'Sun, 22 Nov 2026', 'रवि, २२ नवम्बर २०२६',
    '11:00 am', 'सुबह ११:००',
    '10:30 am – 11:00 am', 'सुबह १०:३० – ११:००',
    '2026-11-22T11:00:00+05:30', '2026-11-22T14:00:00+05:30',
    'Tankri Village', 'टंकरी गाँव',
    'Tankri Village, Rewari, Haryana', 'टंकरी गाँव, रेवाड़ी, हरियाणा',
    'https://www.google.com/maps/search/?api=1&query=Tankri+Village+Rewari+Haryana',
    'Please arrive before the ceremony begins.', 'कृपया रस्म आरंभ होने से पहले पधारें।',
    'Traditional Indian', 'पारंपरिक भारतीय परिधान',
    'Family ceremony at the village home.', 'गाँव के घर पर पारिवारिक रस्म।',
    'ceremony', true, 1, true, 4, 2
  ),
  (
    'bhat', 'bhat', 'Bhat', 'भात',
    'Sun, 22 Nov 2026', 'रवि, २२ नवम्बर २०२६',
    '4:00 pm', 'शाम ४:००',
    '3:30 pm – 4:00 pm', 'दोपहर ३:३० – शाम ४:००',
    '2026-11-22T16:00:00+05:30', '2026-11-22T18:00:00+05:30',
    'Tankri Village', 'टंकरी गाँव',
    'Tankri Village, Rewari, Haryana', 'टंकरी गाँव, रेवाड़ी, हरियाणा',
    'https://www.google.com/maps/search/?api=1&query=Tankri+Village+Rewari+Haryana',
    'Please arrive before the ceremony begins.', 'कृपया रस्म आरंभ होने से पहले पधारें।',
    'Traditional Indian', 'पारंपरिक भारतीय परिधान',
    'Family ceremony at the village home.', 'गाँव के घर पर पारिवारिक रस्म।',
    'ceremony', true, 2, true, 4, 2
  ),
  (
    'chak', 'chak', 'Chak', 'चक',
    'Mon, 23 Nov 2026', 'सोम, २३ नवम्बर २०२६',
    '11:00 am', 'सुबह ११:००',
    '10:30 am – 11:00 am', 'सुबह १०:३० – ११:००',
    '2026-11-23T11:00:00+05:30', '2026-11-23T13:00:00+05:30',
    'Rewari, Haryana', 'रेवाड़ी, हरियाणा',
    'Rewari, Haryana', 'रेवाड़ी, हरियाणा',
    'https://www.google.com/maps/search/?api=1&query=Rewari+Haryana',
    'Please arrive before the ceremony begins.', 'कृपया रस्म आरंभ होने से पहले पधारें।',
    'Traditional Indian', 'पारंपरिक भारतीय परिधान',
    'Please check with the family for any day-of guidance.', 'समारोह के दिन की जानकारी के लिए परिवार से संपर्क करें।',
    'ceremony', true, 3, true, 4, 2
  ),
  (
    'mehendi', 'mehendi', 'Mehandi', 'मेहंदी',
    'Mon, 23 Nov 2026', 'सोम, २३ नवम्बर २०२६',
    '4:00 pm', 'दोपहर ४:००',
    '3:30 pm – 4:00 pm', 'दोपहर ३:३० – ४:००',
    '2026-11-23T16:00:00+05:30', '2026-11-23T18:30:00+05:30',
    'Rewari, Haryana', 'रेवाड़ी, हरियाणा',
    'Rewari, Haryana', 'रेवाड़ी, हरियाणा',
    'https://www.google.com/maps/search/?api=1&query=Rewari+Haryana',
    'Please arrive before the Mehendi begins.', 'कृपया मेहंदी आरंभ होने से पहले पधारें।',
    'Bright festive colours', 'चमकीले उत्सवी रंग',
    'Enjoy an afternoon of Mehendi with the family.', 'परिवार के साथ मेहंदी की दोपहर का आनंद लें।',
    'celebration', true, 4, true, 4, 2
  ),
  (
    'sangeet', 'sangeet', 'Sangeet', 'संगीत',
    'Mon, 23 Nov 2026', 'सोम, २३ नवम्बर २०२६',
    '7:30 pm', 'शाम ७:३०',
    '7:00 pm – 7:30 pm', 'शाम ७:०० – ७:३०',
    '2026-11-23T19:30:00+05:30', '2026-11-23T23:00:00+05:30',
    'Rewari, Haryana', 'रेवाड़ी, हरियाणा',
    'Rewari, Haryana', 'रेवाड़ी, हरियाणा',
    'https://www.google.com/maps/search/?api=1&query=Rewari+Haryana',
    'Please arrive before the performances begin.', 'कृपया प्रस्तुतियाँ आरंभ होने से पहले पधारें।',
    'Bright festive colours', 'चमकीले उत्सवी रंग',
    'Dinner is served during the Sangeet.', 'रात्रिभोज संगीत के दौरान।',
    'celebration', true, 5, true, 4, 2
  ),
  (
    'marriage', 'marriage', 'Marriage', 'विवाह',
    'Tue, 24 Nov 2026', 'मंगल, २४ नवम्बर २०२६',
    '7:00 pm', 'शाम ७:००',
    '6:30 pm – 7:00 pm', 'शाम ६:३० – ७:००',
    '2026-11-24T19:00:00+05:30', '2026-11-25T01:00:00+05:30',
    'Rewari, Haryana', 'रेवाड़ी, हरियाणा',
    'Rewari, Haryana', 'रेवाड़ी, हरियाणा',
    'https://www.google.com/maps/search/?api=1&query=Rewari+Haryana',
    'Please be seated before the muhurat.', 'कृपया मुहूर्त से पहले आसन ग्रहण करें।',
    'Traditional formal', 'पारंपरिक औपचारिक',
    'The reception follows the wedding ceremony.', 'विवाह रस्म के पश्चात स्वागत समारोह।',
    'ceremony', true, 6, true, 4, 2
  )
on conflict (id) do update set
  slug = excluded.slug,
  title_en = excluded.title_en, title_hi = excluded.title_hi,
  date_en = excluded.date_en, date_hi = excluded.date_hi,
  start_time_en = excluded.start_time_en, start_time_hi = excluded.start_time_hi,
  arrival_window_en = excluded.arrival_window_en, arrival_window_hi = excluded.arrival_window_hi,
  start_at = excluded.start_at, end_at = excluded.end_at,
  venue_en = excluded.venue_en, venue_hi = excluded.venue_hi,
  address_en = excluded.address_en, address_hi = excluded.address_hi,
  maps_url = excluded.maps_url,
  entry_note_en = excluded.entry_note_en, entry_note_hi = excluded.entry_note_hi,
  dress_code_en = excluded.dress_code_en, dress_code_hi = excluded.dress_code_hi,
  practical_note_en = excluded.practical_note_en, practical_note_hi = excluded.practical_note_hi,
  category = excluded.category, published = excluded.published,
  display_order = excluded.display_order, default_selected = excluded.default_selected,
  default_adult_limit = excluded.default_adult_limit,
  default_child_limit = excluded.default_child_limit,
  updated_at = now();

commit;
