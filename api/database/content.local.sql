-- Local wedding content for Naman & Neha, with independent groom/bride pages.
--
-- Supplied details: wedding on 24 November 2026; groom from Tankri Village,
-- bride from Rewari, Haryana. Lagan and Bhat dates retain the original seed.
-- Ceremony times, exact home/hall addresses, RSVP cutoffs, and phone numbers
-- remain PLACEHOLDERS for LOCAL TESTING. Confirm them before inviting guests.
-- Haryana customs vary by family; the added rituals are a suggested schedule.
-- Reception/Preeti Bhoj and Pag Phera are optional, family-dependent gatherings.
--
-- Keep private contacts, households, invitation links, and RSVP data out of
-- commits, logs, images, and test fixtures. Never copy this real wedding seed
-- into database/test-fixtures.sql or load it through a production workflow.
--
-- Fresh local Compose databases load this after schema.sql. For an independent
-- loopback database, re-run it with pnpm content:apply from api/.env.local.
-- Reapplying replaces matching seed content; it does not delete other records.
-- Existing groom event IDs stay stable so previously issued links still work.
-- Bride event IDs have a bride- prefix; slugs may match across the two sides.
--
-- Contacts keep the existing valid-format placeholder numbers. Replace them
-- privately with Indian mobiles (10 digits starting with 6-9, or +91 form).

begin;

-- Shared wedding copy, with each team's own couple order, location and contact.
with shared_settings as (
  select
    'Tuesday, 24 November 2026'::text as wedding_date_en,
    'मंगलवार, २४ नवम्बर २०२६'::text as wedding_date_hi,
    '2026-11-24T19:00:00+05:30'::timestamptz as wedding_moment,
    '2026-11-10T23:59:00+05:30'::timestamptz as rsvp_deadline,
    '2026-11-10T23:59:00+05:30'::timestamptz as can_edit_until,
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
    ) as guest_content
), teams (
  id, side, couple_names_en, couple_names_hi,
  location_en, location_hi, coordinator_name, coordinator_phone
) as (
  values
    (1, 'groom', 'Naman & Neha', 'नमन एवं नेहा',
     'Tankri Village, Rewari, Haryana', 'टंकरी गाँव, रेवाड़ी, हरियाणा',
     'Naman', '9000000000'), -- PLACEHOLDER phone
    (2, 'bride', 'Neha & Naman', 'नेहा एवं नमन',
     'Rewari, Haryana', 'रेवाड़ी, हरियाणा',
     'Neha', '9000000000')   -- PLACEHOLDER phone
)
insert into wedding.settings (
  id, side, couple_names_en, couple_names_hi,
  wedding_date_en, wedding_date_hi, location_en, location_hi,
  wedding_moment, rsvp_deadline, can_edit_until,
  coordinator_name, coordinator_phone, guest_content
)
select
  teams.id, teams.side, teams.couple_names_en, teams.couple_names_hi,
  shared_settings.wedding_date_en, shared_settings.wedding_date_hi,
  teams.location_en, teams.location_hi,
  shared_settings.wedding_moment, shared_settings.rsvp_deadline,
  shared_settings.can_edit_until,
  teams.coordinator_name, teams.coordinator_phone, shared_settings.guest_content
from teams cross join shared_settings
on conflict (id) do update set
  side = excluded.side,
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

-- Both teams can choose their own primary contact or the other family contact.
insert into wedding.contacts (side, role, name, phone, is_active) values
  ('groom', 'groom', 'Naman', '9000000000', true), -- PLACEHOLDER phone
  ('groom', 'bride', 'Neha',  '9000000000', true), -- PLACEHOLDER phone
  ('bride', 'groom', 'Naman', '9000000000', true), -- PLACEHOLDER phone
  ('bride', 'bride', 'Neha',  '9000000000', true)  -- PLACEHOLDER phone
on conflict (side, role) do update set
  name = excluded.name,
  phone = excluded.phone,
  is_active = excluded.is_active,
  updated_at = now();

-- Event templates create independent rows, never shared event ownership.
-- audience: both/groom/bride determines which local page includes the ritual.
-- venue_key: home uses that team's home town; tankri/rewari is a shared venue.
-- All times and the broad venue/map locations below are PLACEHOLDERS.
-- Main celebrations are selected by default; smaller family rituals and the
-- optional post-wedding gatherings can be selected per invitation.
with event_plan (
  id, audience, venue_key, title_en, title_hi, date_en, date_hi,
  start_time_en, start_time_hi, arrival_window_en, arrival_window_hi,
  start_at, end_at, dress_code_en, dress_code_hi,
  description_en, description_hi, category, display_order, default_selected
) as (
  values
    (
      'mandha', 'both', 'home', 'Ganesh & Mandha Pujan', 'गणेश एवं मंढा पूजन',
      'Sun, 22 Nov 2026', 'रवि, २२ नवम्बर २०२६',
      '10:00 am', 'सुबह १०:००', '9:30 am – 10:00 am', 'सुबह ९:३० – १०:००',
      '2026-11-22T10:00:00+05:30', '2026-11-22T11:00:00+05:30',
      'Traditional Indian', 'पारंपरिक भारतीय परिधान',
      'A family puja to begin the wedding rituals and seek blessings for the mandap and the couple.',
      'विवाह की रस्में आरंभ करने और मंडप व वर-वधू के लिए आशीर्वाद लेने की पारिवारिक पूजा।',
      'ceremony', 10, false
    ),
    (
      'lagan', 'both', 'tankri', 'Lagan / Tilak', 'लगन / तिलक',
      'Sun, 22 Nov 2026', 'रवि, २२ नवम्बर २०२६',
      '11:00 am', 'सुबह ११:००', '10:30 am – 11:00 am', 'सुबह १०:३० – ११:००',
      '2026-11-22T11:00:00+05:30', '2026-11-22T14:00:00+05:30',
      'Traditional Indian', 'पारंपरिक भारतीय परिधान',
      'The bride’s family brings the lagan to the groom’s home in Tankri, with tilak and blessings from the elders.',
      'वधू का परिवार टंकरी में वर के घर लगन लेकर आएगा। तिलक और बड़ों के आशीर्वाद के साथ रस्म संपन्न होगी।',
      'ceremony', 20, true
    ),
    (
      'bhat', 'both', 'home', 'Bhat / Mama’s Blessings', 'भात / मामा का आशीर्वाद',
      'Sun, 22 Nov 2026', 'रवि, २२ नवम्बर २०२६',
      '4:00 pm', 'शाम ४:००', '3:30 pm – 4:00 pm', 'दोपहर ३:३० – शाम ४:००',
      '2026-11-22T16:00:00+05:30', '2026-11-22T18:00:00+05:30',
      'Traditional Indian', 'पारंपरिक भारतीय परिधान',
      'The maternal family brings bhat, gifts and blessings. Each family hosts its own gathering at home.',
      'ननिहाल की ओर से भात, उपहार और आशीर्वाद की रस्म। दोनों परिवार अपने-अपने घर पर यह आयोजन करेंगे।',
      'ceremony', 30, true
    ),
    (
      'haldi', 'both', 'home', 'Ban / Haldi', 'बान / हल्दी',
      'Mon, 23 Nov 2026', 'सोम, २३ नवम्बर २०२६',
      '10:00 am', 'सुबह १०:००', '9:30 am – 10:00 am', 'सुबह ९:३० – १०:००',
      '2026-11-23T10:00:00+05:30', '2026-11-23T11:00:00+05:30',
      'Yellow or comfortable festive clothes', 'पीले या आरामदायक उत्सवी परिधान',
      'The family’s tel-ban and haldi ritual, with turmeric, blessings and traditional songs at the bride’s and groom’s homes.',
      'वर और वधू के घर पर तेल-बान और हल्दी की रस्म, परिवार के आशीर्वाद और पारंपरिक गीतों के साथ।',
      'ceremony', 40, true
    ),
    (
      'chak', 'both', 'home', 'Chak Pujan', 'चाक पूजन',
      'Mon, 23 Nov 2026', 'सोम, २३ नवम्बर २०२६',
      '11:00 am', 'सुबह ११:००', '10:30 am – 11:00 am', 'सुबह १०:३० – ११:००',
      '2026-11-23T11:00:00+05:30', '2026-11-23T13:00:00+05:30',
      'Traditional Indian', 'पारंपरिक भारतीय परिधान',
      'A Haryanvi family ritual honouring the potter’s wheel and ceremonial earthenware. Follow the elders’ guidance for the local custom.',
      'कुम्हार के चाक और रस्मों में काम आने वाले मिट्टी के बर्तनों का पूजन। परिवार की परंपरा के अनुसार बड़ों के मार्गदर्शन में रस्म होगी।',
      'ceremony', 50, true
    ),
    (
      'mehendi', 'both', 'home', 'Mehendi', 'मेहंदी',
      'Mon, 23 Nov 2026', 'सोम, २३ नवम्बर २०२६',
      '4:00 pm', 'शाम ४:००', '3:30 pm – 4:00 pm', 'दोपहर ३:३० – शाम ४:००',
      '2026-11-23T16:00:00+05:30', '2026-11-23T18:30:00+05:30',
      'Bright festive colours', 'चमकीले उत्सवी रंग',
      'An afternoon of mehendi, music and time with the family. The two families celebrate in their own home towns.',
      'मेहंदी, गीत-संगीत और परिवार के साथ एक उत्सवी दोपहर। दोनों परिवार अपने-अपने घर पर यह आयोजन करेंगे।',
      'celebration', 60, true
    ),
    (
      'sangeet', 'both', 'home', 'Sangeet / Ladies’ Sangeet', 'संगीत / महिला संगीत',
      'Mon, 23 Nov 2026', 'सोम, २३ नवम्बर २०२६',
      '7:30 pm', 'शाम ७:३०', '7:00 pm – 7:30 pm', 'शाम ७:०० – ७:३०',
      '2026-11-23T19:30:00+05:30', '2026-11-23T23:00:00+05:30',
      'Bright festive colours', 'चमकीले उत्सवी रंग',
      'Traditional wedding songs, dholak, dancing and family performances, followed by dinner.',
      'पारंपरिक विवाह गीत, ढोलक, नृत्य और परिवार की प्रस्तुतियाँ, साथ में रात्रिभोज।',
      'celebration', 70, true
    ),
    (
      'sehra-bandi', 'groom', 'home', 'Sehra Bandi', 'सेहरा बंदी',
      'Tue, 24 Nov 2026', 'मंगल, २४ नवम्बर २०२६',
      '2:30 pm', 'दोपहर २:३०', '2:00 pm – 2:30 pm', 'दोपहर २:०० – २:३०',
      '2026-11-24T14:30:00+05:30', '2026-11-24T15:15:00+05:30',
      'Traditional formal', 'पारंपरिक औपचारिक',
      'The groom’s family ties the sehra and offers blessings before the baraat leaves Tankri.',
      'बारात के टंकरी से रवाना होने से पहले वर के परिवार द्वारा सेहरा बाँधने और आशीर्वाद देने की रस्म।',
      'ceremony', 80, false
    ),
    (
      'ghudchadhi', 'groom', 'home', 'Ghudchadhi & Baraat Departure', 'घुड़चढ़ी एवं बारात प्रस्थान',
      'Tue, 24 Nov 2026', 'मंगल, २४ नवम्बर २०२६',
      '3:30 pm', 'दोपहर ३:३०', '3:00 pm – 3:30 pm', 'दोपहर ३:०० – ३:३०',
      '2026-11-24T15:30:00+05:30', '2026-11-24T16:30:00+05:30',
      'Traditional formal; comfortable footwear', 'पारंपरिक औपचारिक परिधान; आरामदायक जूते',
      'The groom’s procession gathers in Tankri for ghudchadhi before travelling to the wedding in Rewari.',
      'घुड़चढ़ी के लिए बारात टंकरी में एकत्र होगी और फिर रेवाड़ी में विवाह के लिए रवाना होगी।',
      'celebration', 90, false
    ),
    (
      'baraat-milni', 'both', 'rewari', 'Baraat Welcome & Milni', 'बारात स्वागत एवं मिलनी',
      'Tue, 24 Nov 2026', 'मंगल, २४ नवम्बर २०२६',
      '6:00 pm', 'शाम ६:००', '5:30 pm – 6:00 pm', 'शाम ५:३० – ६:००',
      '2026-11-24T18:00:00+05:30', '2026-11-24T19:00:00+05:30',
      'Traditional formal', 'पारंपरिक औपचारिक',
      'The bride’s family welcomes the baraat in Rewari, with milni and greetings between the two families.',
      'रेवाड़ी में वधू का परिवार बारात का स्वागत करेगा। मिलनी के साथ दोनों परिवार एक-दूसरे का अभिनंदन करेंगे।',
      'celebration', 100, true
    ),
    (
      'marriage', 'both', 'rewari', 'Wedding & Jaimala', 'विवाह एवं वरमाला',
      'Tue, 24 Nov 2026', 'मंगल, २४ नवम्बर २०२६',
      '7:00 pm', 'शाम ७:००', '6:30 pm – 7:00 pm', 'शाम ६:३० – ७:००',
      '2026-11-24T19:00:00+05:30', '2026-11-25T01:00:00+05:30',
      'Traditional formal', 'पारंपरिक औपचारिक',
      'Celebrate Naman and Neha’s wedding, beginning with jaimala and family blessings. The wedding rituals continue into the night.',
      'वरमाला और परिवार के आशीर्वाद के साथ नमन और नेहा के विवाह का उत्सव। विवाह की रस्में रात तक चलेंगी।',
      'ceremony', 110, true
    ),
    (
      'wedding-dinner', 'both', 'rewari', 'Wedding Dinner', 'विवाह रात्रिभोज',
      'Tue, 24 Nov 2026', 'मंगल, २४ नवम्बर २०२६',
      '8:00 pm', 'रात ८:००', '8:00 pm onwards', 'रात ८:०० बजे से',
      '2026-11-24T20:00:00+05:30', '2026-11-24T22:30:00+05:30',
      'Wedding attire', 'विवाह के परिधान',
      'Dinner with both families during the wedding celebrations in Rewari.',
      'रेवाड़ी में विवाह समारोह के दौरान दोनों परिवारों के साथ रात्रिभोज।',
      'reception', 120, true
    ),
    (
      'pheras', 'both', 'rewari', 'Pheras & Kanyadaan', 'फेरे एवं कन्यादान',
      'Tue night, 24 Nov – Wed, 25 Nov 2026', 'मंगल रात, २४ नवम्बर – बुध, २५ नवम्बर २०२६',
      '11:00 pm', 'रात ११:००', '10:30 pm – 11:00 pm', 'रात १०:३० – ११:००',
      '2026-11-24T23:00:00+05:30', '2026-11-25T00:30:00+05:30',
      'Traditional Indian', 'पारंपरिक भारतीय परिधान',
      'The sacred wedding vows around the agni, with kanyadaan and blessings. The final muhurat will be confirmed by the family and pandit.',
      'अग्नि के समक्ष विवाह के फेरे, कन्यादान और आशीर्वाद। अंतिम मुहूर्त परिवार और पंडित जी से पुष्टि के बाद तय होगा।',
      'ceremony', 130, false
    ),
    (
      'vidaai', 'both', 'rewari', 'Vidaai', 'विदाई',
      'Wed, 25 Nov 2026 (after midnight)', 'बुध, २५ नवम्बर २०२६ (आधी रात के बाद)',
      '12:30 am', 'रात १२:३०', '12:15 am – 12:30 am', 'रात १२:१५ – १२:३०',
      '2026-11-25T00:30:00+05:30', '2026-11-25T01:00:00+05:30',
      'Wedding attire', 'विवाह के परिधान',
      'The bride’s farewell from Rewari after the wedding rituals, with the blessings of her family.',
      'विवाह की रस्मों के बाद रेवाड़ी से वधू की विदाई, परिवार के आशीर्वाद के साथ।',
      'ceremony', 140, false
    ),
    (
      'griha-pravesh', 'groom', 'home', 'Griha Pravesh / Bride’s Welcome', 'गृह प्रवेश / नववधू का स्वागत',
      'Wed, 25 Nov 2026 (early morning)', 'बुध, २५ नवम्बर २०२६ (भोर में)',
      '2:00 am', 'रात २:००', '1:45 am – 2:00 am', 'रात १:४५ – २:००',
      '2026-11-25T02:00:00+05:30', '2026-11-25T02:30:00+05:30',
      'Comfortable traditional clothes', 'आरामदायक पारंपरिक परिधान',
      'The groom’s family welcomes Neha to the home in Tankri with a small family griha pravesh ceremony.',
      'टंकरी में वर का परिवार गृह प्रवेश की पारिवारिक रस्म के साथ नेहा का स्वागत करेगा।',
      'ceremony', 150, false
    ),
    (
      'pag-phera', 'bride', 'home', 'Pag Phera / Return to the Bride’s Home', 'पगफेरा / मायके आगमन',
      'Wed, 25 Nov 2026', 'बुध, २५ नवम्बर २०२६',
      '11:00 am', 'सुबह ११:००', '10:30 am – 11:00 am', 'सुबह १०:३० – ११:००',
      '2026-11-25T11:00:00+05:30', '2026-11-25T13:00:00+05:30',
      'Comfortable traditional clothes', 'आरामदायक पारंपरिक परिधान',
      'An optional family visit to Neha’s home in Rewari after the wedding. The family will confirm the day and timing according to its custom.',
      'विवाह के बाद नेहा के रेवाड़ी स्थित मायके में पारिवारिक आगमन की वैकल्पिक रस्म। परिवार अपनी परंपरा के अनुसार दिन और समय की पुष्टि करेगा।',
      'ceremony', 160, false
    ),
    (
      'reception', 'both', 'tankri', 'Reception / Ashirwad & Preeti Bhoj', 'आशीर्वाद समारोह एवं प्रीतिभोज',
      'Wed, 25 Nov 2026', 'बुध, २५ नवम्बर २०२६',
      '6:30 pm', 'शाम ६:३०', '6:00 pm – 6:30 pm', 'शाम ६:०० – ६:३०',
      '2026-11-25T18:30:00+05:30', '2026-11-25T22:00:00+05:30',
      'Festive or traditional formal', 'उत्सवी या पारंपरिक औपचारिक परिधान',
      'An optional post-wedding gathering in Tankri to bless the newlyweds and share a meal. Confirm with the family whether this gathering is planned.',
      'टंकरी में नवविवाहित जोड़े को आशीर्वाद देने और साथ भोजन करने का वैकल्पिक आयोजन। कार्यक्रम की पुष्टि परिवार से करें।',
      'reception', 170, false
    )
), teams (side, home_venue_key) as (
  values ('groom', 'tankri'), ('bride', 'rewari')
), venues (venue_key, venue_en, venue_hi, address_en, address_hi, maps_url) as (
  values
    ('tankri', 'Tankri Village', 'टंकरी गाँव',
     'Tankri Village, Rewari, Haryana', 'टंकरी गाँव, रेवाड़ी, हरियाणा',
     'https://www.google.com/maps/search/?api=1&query=Tankri+Village+Rewari+Haryana'),
    ('rewari', 'Rewari, Haryana', 'रेवाड़ी, हरियाणा',
     'Rewari, Haryana', 'रेवाड़ी, हरियाणा',
     'https://www.google.com/maps/search/?api=1&query=Rewari+Haryana')
)
insert into wedding.events (
  id, side, slug, title_en, title_hi, date_en, date_hi,
  start_time_en, start_time_hi, arrival_window_en, arrival_window_hi,
  start_at, end_at, venue_en, venue_hi, address_en, address_hi, maps_url,
  entry_note_en, entry_note_hi, dress_code_en, dress_code_hi,
  practical_note_en, practical_note_hi, description_en, description_hi,
  category, published, display_order, default_selected,
  default_adult_limit, default_child_limit
)
select
  case when teams.side = 'groom' then event_plan.id else 'bride-' || event_plan.id end,
  teams.side, event_plan.id,
  event_plan.title_en, event_plan.title_hi, event_plan.date_en, event_plan.date_hi,
  event_plan.start_time_en, event_plan.start_time_hi,
  event_plan.arrival_window_en, event_plan.arrival_window_hi,
  event_plan.start_at::timestamptz, event_plan.end_at::timestamptz,
  venues.venue_en, venues.venue_hi, venues.address_en, venues.address_hi, venues.maps_url,
  'Please arrive during the arrival window and follow the family’s guidance.',
  'कृपया दिए गए आगमन समय में पधारें और परिवार के मार्गदर्शन का पालन करें।',
  event_plan.dress_code_en, event_plan.dress_code_hi,
  case
    when event_plan.id in ('pheras', 'vidaai', 'griha-pravesh')
      then 'The wedding rituals continue past midnight into 25 November. Please confirm the final timing with the family.'
    when event_plan.id in ('pag-phera', 'reception')
      then 'Please confirm whether this gathering is planned before arranging travel.'
    else 'Please confirm the final time and exact venue address with the family.'
  end,
  case
    when event_plan.id in ('pheras', 'vidaai', 'griha-pravesh')
      then 'विवाह की रस्में आधी रात के बाद २५ नवम्बर तक चलेंगी। अंतिम समय की पुष्टि परिवार से करें।'
    when event_plan.id in ('pag-phera', 'reception')
      then 'यात्रा की योजना बनाने से पहले परिवार से इस आयोजन की पुष्टि करें।'
    else 'अंतिम समय और आयोजन स्थल के पूरे पते की पुष्टि परिवार से करें।'
  end,
  event_plan.description_en, event_plan.description_hi,
  event_plan.category, true, event_plan.display_order, event_plan.default_selected,
  4, 2
from event_plan
join teams on event_plan.audience = 'both' or event_plan.audience = teams.side
join venues on venues.venue_key = case
  when event_plan.venue_key = 'home' then teams.home_venue_key
  else event_plan.venue_key
end
on conflict (id) do update set
  -- The schema's immutable-side trigger rejects any ownership collision.
  side = excluded.side,
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
  description_en = excluded.description_en, description_hi = excluded.description_hi,
  category = excluded.category, published = excluded.published,
  display_order = excluded.display_order, default_selected = excluded.default_selected,
  default_adult_limit = excluded.default_adult_limit,
  default_child_limit = excluded.default_child_limit,
  updated_at = now();

commit;
