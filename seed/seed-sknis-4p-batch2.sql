-- ============================================================
-- Seed batch: all 18 real uploaded files (img1.jpeg-img18.jpeg)
-- Every file gets a sources + proof_documents row. Images 2-9
-- are duplicates of content already seeded via the FIRST batch
-- (the descriptively-named 4p-*.jpeg files) and deliberately
-- get NO claims here — see the comment on each to know why.
-- Requires citizen_impact column on claims — migration below.
-- ============================================================

ALTER TABLE claims ADD COLUMN IF NOT EXISTS citizen_impact TEXT;

-- ---- img1.jpeg  ----
INSERT INTO sources (id, source_type, channel, title, speaker_org, origin_url, published_at)
VALUES ('5acce44f-7ff2-4740-9034-c1cb34177f12', 'official_govt', 'social_post', 'SKNIS "4P" campaign graphic — img1.jpeg', 'SKNIS', 'https://www.facebook.com/sknismedia/photos', NULL);

INSERT INTO proof_documents (id, file_url, file_type, title, uploaded_at, notes)
VALUES ('07d0f826-a79c-4b8c-96f7-f9a61eee098b', 'seed/images/img1.jpeg', 'jpeg', 'SKNIS 4P graphic: img1.jpeg', now(), NULL);

-- ---- img2.jpeg (DUPLICATE — no claims, see note) Duplicate of item 39 National Disability Policy — already seeded via first batch (4p-housing-1.jpeg) ----
INSERT INTO sources (id, source_type, channel, title, speaker_org, origin_url, published_at)
VALUES ('0cc141fe-1cd2-4035-98f8-706f62a8d69b', 'official_govt', 'social_post', 'SKNIS "4P" campaign graphic — img2.jpeg', 'SKNIS', 'https://www.facebook.com/sknismedia/photos', NULL);

INSERT INTO proof_documents (id, file_url, file_type, title, uploaded_at, notes)
VALUES ('00c3de88-f20d-4b87-b999-577ffea9992f', 'seed/images/img2.jpeg', 'jpeg', 'SKNIS 4P graphic: img2.jpeg', now(), 'Duplicate of item 39 National Disability Policy — already seeded via first batch (4p-housing-1.jpeg)');

-- ---- img3.jpeg (DUPLICATE — no claims, see note) Duplicate of Housing items 1-12 — already seeded via first batch (4p-housing-2.jpeg) ----
INSERT INTO sources (id, source_type, channel, title, speaker_org, origin_url, published_at)
VALUES ('e3be31a8-ceec-4701-8b67-4151e9a8414a', 'official_govt', 'social_post', 'SKNIS "4P" campaign graphic — img3.jpeg', 'SKNIS', 'https://www.facebook.com/sknismedia/photos', NULL);

INSERT INTO proof_documents (id, file_url, file_type, title, uploaded_at, notes)
VALUES ('513e8c86-0417-4750-8d52-827bfc3e9c45', 'seed/images/img3.jpeg', 'jpeg', 'SKNIS 4P graphic: img3.jpeg', now(), 'Duplicate of Housing items 1-12 — already seeded via first batch (4p-housing-2.jpeg)');

-- ---- img4.jpeg (DUPLICATE — no claims, see note) Duplicate of Housing items 28-38 — already seeded via first batch (4p-housing-4.jpeg) ----
INSERT INTO sources (id, source_type, channel, title, speaker_org, origin_url, published_at)
VALUES ('fc49162a-964d-4a37-befb-d39bcdfdf51e', 'official_govt', 'social_post', 'SKNIS "4P" campaign graphic — img4.jpeg', 'SKNIS', 'https://www.facebook.com/sknismedia/photos', NULL);

INSERT INTO proof_documents (id, file_url, file_type, title, uploaded_at, notes)
VALUES ('21dfdc73-df24-41aa-a56b-10ecafbd0c9c', 'seed/images/img4.jpeg', 'jpeg', 'SKNIS 4P graphic: img4.jpeg', now(), 'Duplicate of Housing items 28-38 — already seeded via first batch (4p-housing-4.jpeg)');

-- ---- img5.jpeg (DUPLICATE — no claims, see note) Duplicate of Government items 27-35 — already seeded via first batch (4p-government-3.jpeg) ----
INSERT INTO sources (id, source_type, channel, title, speaker_org, origin_url, published_at)
VALUES ('b176ac27-c29f-4d93-b346-6637b3ed0621', 'official_govt', 'social_post', 'SKNIS "4P" campaign graphic — img5.jpeg', 'SKNIS', 'https://www.facebook.com/sknismedia/photos', NULL);

INSERT INTO proof_documents (id, file_url, file_type, title, uploaded_at, notes)
VALUES ('127f90f8-9a5a-4abc-8905-30c60b3ab596', 'seed/images/img5.jpeg', 'jpeg', 'SKNIS 4P graphic: img5.jpeg', now(), 'Duplicate of Government items 27-35 — already seeded via first batch (4p-government-3.jpeg)');

-- ---- img6.jpeg (DUPLICATE — no claims, see note) Duplicate of Government legislative acts — already seeded via first batch (4p-government-1.jpeg) ----
INSERT INTO sources (id, source_type, channel, title, speaker_org, origin_url, published_at)
VALUES ('6024c4ec-d278-4853-bb1e-793a1f248418', 'official_govt', 'social_post', 'SKNIS "4P" campaign graphic — img6.jpeg', 'SKNIS', 'https://www.facebook.com/sknismedia/photos', NULL);

INSERT INTO proof_documents (id, file_url, file_type, title, uploaded_at, notes)
VALUES ('e659f62d-b9f1-4177-9436-5bc8314c0876', 'seed/images/img6.jpeg', 'jpeg', 'SKNIS 4P graphic: img6.jpeg', now(), 'Duplicate of Government legislative acts — already seeded via first batch (4p-government-1.jpeg)');

-- ---- img7.jpeg (DUPLICATE — no claims, see note) Duplicate of Government items 14-26 — already seeded via first batch (4p-government-2.jpeg) ----
INSERT INTO sources (id, source_type, channel, title, speaker_org, origin_url, published_at)
VALUES ('1eef835b-068f-4c30-9e41-a79217633ebf', 'official_govt', 'social_post', 'SKNIS "4P" campaign graphic — img7.jpeg', 'SKNIS', 'https://www.facebook.com/sknismedia/photos', NULL);

INSERT INTO proof_documents (id, file_url, file_type, title, uploaded_at, notes)
VALUES ('519513e6-6da7-4250-afc0-b4560df67d2e', 'seed/images/img7.jpeg', 'jpeg', 'SKNIS 4P graphic: img7.jpeg', now(), 'Duplicate of Government items 14-26 — already seeded via first batch (4p-government-2.jpeg)');

-- ---- img8.jpeg (DUPLICATE — no claims, see note) Duplicate of Government items 1-13 — already seeded via first batch (4p-government-4.jpeg) ----
INSERT INTO sources (id, source_type, channel, title, speaker_org, origin_url, published_at)
VALUES ('f34414ef-10ac-4cc9-bd17-e1d882c2828c', 'official_govt', 'social_post', 'SKNIS "4P" campaign graphic — img8.jpeg', 'SKNIS', 'https://www.facebook.com/sknismedia/photos', NULL);

INSERT INTO proof_documents (id, file_url, file_type, title, uploaded_at, notes)
VALUES ('c49b045d-c633-4585-a36a-521bf64d6828', 'seed/images/img8.jpeg', 'jpeg', 'SKNIS 4P graphic: img8.jpeg', now(), 'Duplicate of Government items 1-13 — already seeded via first batch (4p-government-4.jpeg)');

-- ---- img9.jpeg (DUPLICATE — no claims, see note) Duplicate of Education items 35-36 — already seeded via first batch (4p-education-1.jpeg) ----
INSERT INTO sources (id, source_type, channel, title, speaker_org, origin_url, published_at)
VALUES ('b0c9d563-06e2-488f-a64e-04b1349b3772', 'official_govt', 'social_post', 'SKNIS "4P" campaign graphic — img9.jpeg', 'SKNIS', 'https://www.facebook.com/sknismedia/photos', NULL);

INSERT INTO proof_documents (id, file_url, file_type, title, uploaded_at, notes)
VALUES ('7c7a4f76-f3ed-48ea-a70c-32a70e9516d2', 'seed/images/img9.jpeg', 'jpeg', 'SKNIS 4P graphic: img9.jpeg', now(), 'Duplicate of Education items 35-36 — already seeded via first batch (4p-education-1.jpeg)');

-- ---- img10.jpeg  ----
INSERT INTO sources (id, source_type, channel, title, speaker_org, origin_url, published_at)
VALUES ('d20edff2-f598-4b08-851f-63e276c6eae5', 'official_govt', 'social_post', 'SKNIS "4P" campaign graphic — img10.jpeg', 'SKNIS', 'https://www.facebook.com/sknismedia/photos', NULL);

INSERT INTO proof_documents (id, file_url, file_type, title, uploaded_at, notes)
VALUES ('6c3278f2-b5e4-494d-bf60-698cf902f09f', 'seed/images/img10.jpeg', 'jpeg', 'SKNIS 4P graphic: img10.jpeg', now(), NULL);

-- ---- img11.jpeg  ----
INSERT INTO sources (id, source_type, channel, title, speaker_org, origin_url, published_at)
VALUES ('5cfe218e-a048-42f4-a4a3-91f2db05caf2', 'official_govt', 'social_post', 'SKNIS "4P" campaign graphic — img11.jpeg', 'SKNIS', 'https://www.facebook.com/sknismedia/photos', NULL);

INSERT INTO proof_documents (id, file_url, file_type, title, uploaded_at, notes)
VALUES ('680b312d-8656-445e-9608-79b0b5effa1e', 'seed/images/img11.jpeg', 'jpeg', 'SKNIS 4P graphic: img11.jpeg', now(), NULL);

-- ---- img12.jpeg  ----
INSERT INTO sources (id, source_type, channel, title, speaker_org, origin_url, published_at)
VALUES ('99f40124-b878-47f8-9faa-743f4835a0e9', 'official_govt', 'social_post', 'SKNIS "4P" campaign graphic — img12.jpeg', 'SKNIS', 'https://www.facebook.com/sknismedia/photos', NULL);

INSERT INTO proof_documents (id, file_url, file_type, title, uploaded_at, notes)
VALUES ('2509c113-d989-4369-96d8-30222906464d', 'seed/images/img12.jpeg', 'jpeg', 'SKNIS 4P graphic: img12.jpeg', now(), NULL);

-- ---- img13.jpeg  ----
INSERT INTO sources (id, source_type, channel, title, speaker_org, origin_url, published_at)
VALUES ('3dba96c7-1983-48af-b61a-ffd834f5850f', 'official_govt', 'social_post', 'SKNIS "4P" campaign graphic — img13.jpeg', 'SKNIS', 'https://www.facebook.com/sknismedia/photos', NULL);

INSERT INTO proof_documents (id, file_url, file_type, title, uploaded_at, notes)
VALUES ('c24cd251-2d47-4d9a-89f2-deae70523406', 'seed/images/img13.jpeg', 'jpeg', 'SKNIS 4P graphic: img13.jpeg', now(), NULL);

-- ---- img14.jpeg  ----
INSERT INTO sources (id, source_type, channel, title, speaker_org, origin_url, published_at)
VALUES ('0ca5fb89-c649-4984-9ea2-4088554741bf', 'official_govt', 'social_post', 'SKNIS "4P" campaign graphic — img14.jpeg', 'SKNIS', 'https://www.facebook.com/sknismedia/photos', NULL);

INSERT INTO proof_documents (id, file_url, file_type, title, uploaded_at, notes)
VALUES ('f741113b-eaf7-44af-82bd-5977a68d377f', 'seed/images/img14.jpeg', 'jpeg', 'SKNIS 4P graphic: img14.jpeg', now(), NULL);

-- ---- img15.jpeg  ----
INSERT INTO sources (id, source_type, channel, title, speaker_org, origin_url, published_at)
VALUES ('09688dc4-fee9-4584-9327-5393e9826e7e', 'official_govt', 'social_post', 'SKNIS "4P" campaign graphic — img15.jpeg', 'SKNIS', 'https://www.facebook.com/sknismedia/photos', NULL);

INSERT INTO proof_documents (id, file_url, file_type, title, uploaded_at, notes)
VALUES ('20131ac3-de75-4372-959a-7d82dc4aeb4d', 'seed/images/img15.jpeg', 'jpeg', 'SKNIS 4P graphic: img15.jpeg', now(), NULL);

-- ---- img16.jpeg  ----
INSERT INTO sources (id, source_type, channel, title, speaker_org, origin_url, published_at)
VALUES ('10e8b24e-4cc8-4058-b5c3-d95a1f780434', 'official_govt', 'social_post', 'SKNIS "4P" campaign graphic — img16.jpeg', 'SKNIS', 'https://www.facebook.com/sknismedia/photos', NULL);

INSERT INTO proof_documents (id, file_url, file_type, title, uploaded_at, notes)
VALUES ('3819ab2b-8ec7-4cd3-a36a-63d4c5954ed4', 'seed/images/img16.jpeg', 'jpeg', 'SKNIS 4P graphic: img16.jpeg', now(), NULL);

-- ---- img17.jpeg  ----
INSERT INTO sources (id, source_type, channel, title, speaker_org, origin_url, published_at)
VALUES ('6348728c-338b-46d6-9cc2-5c5eca0dfaff', 'official_govt', 'social_post', 'SKNIS "4P" campaign graphic — img17.jpeg', 'SKNIS', 'https://www.facebook.com/sknismedia/photos', NULL);

INSERT INTO proof_documents (id, file_url, file_type, title, uploaded_at, notes)
VALUES ('b5942eaf-311e-4e4b-b68f-a6e863188cff', 'seed/images/img17.jpeg', 'jpeg', 'SKNIS 4P graphic: img17.jpeg', now(), NULL);

-- ---- img18.jpeg  ----
INSERT INTO sources (id, source_type, channel, title, speaker_org, origin_url, published_at)
VALUES ('30532a63-b388-4e9b-93d1-b5c834499120', 'official_govt', 'social_post', 'SKNIS "4P" campaign graphic — img18.jpeg', 'SKNIS', 'https://www.facebook.com/sknismedia/photos', NULL);

INSERT INTO proof_documents (id, file_url, file_type, title, uploaded_at, notes)
VALUES ('c7092f22-6083-4679-971b-c7b66a719dfe', 'seed/images/img18.jpeg', 'jpeg', 'SKNIS 4P graphic: img18.jpeg', now(), NULL);

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status, citizen_impact)
VALUES ('6be33515-fccc-490a-a771-cfc70e493c6a', 'accomplishment', 'Paid a one-time worker''s bonus of $500 to all non-civil servants', 'Worker''s bonus of $500 paid to all non-civil servants in December 2023.', 'Social Protection', '2023-12-01', 2023, 'claude_vision_manual', 'medium', 'pending_review', 'A direct, one-time payment — if you worked outside the civil service in Dec 2023, this was money in your pocket, not a long-term policy.');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('6be33515-fccc-490a-a771-cfc70e493c6a', '5acce44f-7ff2-4740-9034-c1cb34177f12');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('6be33515-fccc-490a-a771-cfc70e493c6a', '07d0f826-a79c-4b8c-96f7-f9a61eee098b');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status, citizen_impact)
VALUES ('ae7207de-4352-410a-b090-c3d6a73b4e56', 'accomplishment', 'Extended pension eligibility to Government Auxiliary Employees', 'Pension eligibility extended to Government Auxiliary Employees and other monthly-paid government workers employed on or after 18 May 2012.', 'Social Protection', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review', 'If you''re a GAE or monthly-paid government worker hired after May 2012, this is a real change to your retirement benefits — worth checking with HR whether you''re now eligible.');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('ae7207de-4352-410a-b090-c3d6a73b4e56', '5acce44f-7ff2-4740-9034-c1cb34177f12');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('ae7207de-4352-410a-b090-c3d6a73b4e56', '07d0f826-a79c-4b8c-96f7-f9a61eee098b');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status, citizen_impact)
VALUES ('34bc736e-5d47-4a00-9b45-31c9b1cd8a66', 'accomplishment', 'Reduced Development Bank student-loan interest rates from 9% to 5%', 'Interest rate on Development Bank student loans cut from 9% to 5%.', 'Education', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review', 'If you have a student loan through the Development Bank, this directly lowers what you owe in interest going forward — a real reduction in your monthly/total repayment burden.');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('34bc736e-5d47-4a00-9b45-31c9b1cd8a66', 'd20edff2-f598-4b08-851f-63e276c6eae5');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('34bc736e-5d47-4a00-9b45-31c9b1cd8a66', '6c3278f2-b5e4-494d-bf60-698cf902f09f');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status, citizen_impact)
VALUES ('f8a7b1be-2aae-4ee0-983d-61c9412dbc61', 'accomplishment', 'Introduced the Graduate Refinance Project offering EC$15,000 in loan credit', 'Provides student-loan holders a proposed EC$15,000 credit toward loans held at the Development Bank and other financial institutions.', 'Education', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review', 'For graduates carrying student debt, this is a concrete dollar amount knocked off what you owe — worth checking eligibility if you have a qualifying loan.');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('f8a7b1be-2aae-4ee0-983d-61c9412dbc61', 'd20edff2-f598-4b08-851f-63e276c6eae5');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('f8a7b1be-2aae-4ee0-983d-61c9412dbc61', '6c3278f2-b5e4-494d-bf60-698cf902f09f');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status, citizen_impact)
VALUES ('8fd0bf31-c1e8-493f-b88b-63bd10810765', 'accomplishment', 'Reinstated a stipend for all nursing students at CFBC', 'Stipend reinstated for all nursing students at the Clarence Fitzroy Bryant College.', 'Education', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review', 'If you''re studying nursing at CFBC, this is direct financial support while you train — makes nursing school more affordable.');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('8fd0bf31-c1e8-493f-b88b-63bd10810765', 'd20edff2-f598-4b08-851f-63e276c6eae5');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('8fd0bf31-c1e8-493f-b88b-63bd10810765', '6c3278f2-b5e4-494d-bf60-698cf902f09f');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status, citizen_impact)
VALUES ('de578d23-ce58-4c55-aacf-b0d0cea4a4cf', 'accomplishment', 'Assigned a guidance counsellor to every primary school', 'A dedicated guidance counsellor was assigned to each primary school nationally.', 'Education', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review', 'If you have a child in primary school, they now have direct access to a counsellor at their own school — support that wasn''t guaranteed everywhere before.');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('de578d23-ce58-4c55-aacf-b0d0cea4a4cf', '5cfe218e-a048-42f4-a4a3-91f2db05caf2');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('de578d23-ce58-4c55-aacf-b0d0cea4a4cf', '680b312d-8656-445e-9608-79b0b5effa1e');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status, citizen_impact)
VALUES ('7738d648-3043-4151-bcaa-b8b0fd3bb4ec', 'accomplishment', 'Provided EC$25,000 grants for study in fields relevant to national development', 'A grant of EC$25,000 offered to every student pursuing undergraduate or graduate studies in a field immediately relevant to national development.', 'Education', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review', 'For students in qualifying fields, this is a substantial chunk of tuition or living costs covered directly — worth checking if your intended field of study qualifies.');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('7738d648-3043-4151-bcaa-b8b0fd3bb4ec', '5cfe218e-a048-42f4-a4a3-91f2db05caf2');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('7738d648-3043-4151-bcaa-b8b0fd3bb4ec', '680b312d-8656-445e-9608-79b0b5effa1e');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status, citizen_impact)
VALUES ('11c58482-f5d0-4d92-bf18-61b0597c3d16', 'accomplishment', 'Reinstated the One-to-One Laptop Programme and provided tablets to primary students', 'Laptop programme reinstated, alongside tablets provided to primary school students and expanded digital-learning solutions in 2025.', 'Education', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review', 'If you have a school-age child, this affects whether they have a device for schoolwork at home — a direct household cost saved if your child qualifies.');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('11c58482-f5d0-4d92-bf18-61b0597c3d16', '5cfe218e-a048-42f4-a4a3-91f2db05caf2');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('11c58482-f5d0-4d92-bf18-61b0597c3d16', '680b312d-8656-445e-9608-79b0b5effa1e');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status, citizen_impact)
VALUES ('dccc94c1-6746-421e-93fa-b6074d8ee31b', 'accomplishment', 'Officially launched the Ministry of Creative Economy', 'A dedicated Ministry of Creative Economy launched to grow business opportunities for local artistes, alongside the creatives.kn platform and Project TRANSFORM.', 'Other', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review', 'If you work in music, art, or the creative sector locally, this is a government body specifically meant to support your work — worth knowing it exists as a resource.');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('dccc94c1-6746-421e-93fa-b6074d8ee31b', '99f40124-b878-47f8-9faa-743f4835a0e9');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('dccc94c1-6746-421e-93fa-b6074d8ee31b', '2509c113-d989-4369-96d8-30222906464d');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status, citizen_impact)
VALUES ('63077edd-b032-4510-b994-11abcfd7d075', 'accomplishment', 'Broke ground for a dedicated Creative Arts Centre', 'A Creative Arts Centre broke ground, designed to provide dedicated space for artistic expression, training and cultural development.', 'Other', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review', 'Long run: a physical space for arts training and events that doesn''t currently exist — matters most to families and students involved in the arts.');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('63077edd-b032-4510-b994-11abcfd7d075', '99f40124-b878-47f8-9faa-743f4835a0e9');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('63077edd-b032-4510-b994-11abcfd7d075', '2509c113-d989-4369-96d8-30222906464d');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status, citizen_impact)
VALUES ('40b5105f-8a36-4f82-b1b5-56de7d40a4f4', 'accomplishment', 'Successfully hosted the 2026 IHF Trophy NACHC Beach Handball Championships', 'Federation hosted the 2026 IHF Trophy NACHC Beach Handball Championships.', 'Other', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review', 'Hosting international sporting events like this brings visitors and media attention — an indirect economic benefit (tourism, local business) rather than a direct household one.');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('40b5105f-8a36-4f82-b1b5-56de7d40a4f4', '99f40124-b878-47f8-9faa-743f4835a0e9');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('40b5105f-8a36-4f82-b1b5-56de7d40a4f4', '2509c113-d989-4369-96d8-30222906464d');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status, citizen_impact)
VALUES ('8bedc341-5ace-464c-b3c8-89729e172064', 'accomplishment', 'Implemented a phased ban on single-use plastics', 'Phased ban introduced with mandated biodegradable alternatives, import licensing, and enforcement penalties.', 'Environment', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review', 'Right now: fewer plastic bags and containers in shops as alternatives phase in. Over time: less plastic waste in landfills and around the coastline, which matters directly for a country that depends on clean beaches for tourism.');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('8bedc341-5ace-464c-b3c8-89729e172064', '3dba96c7-1983-48af-b61a-ffd834f5850f');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('8bedc341-5ace-464c-b3c8-89729e172064', 'c24cd251-2d47-4d9a-89f2-deae70523406');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status, citizen_impact)
VALUES ('2e997d44-8f65-4645-9b91-5d9a3ca55940', 'accomplishment', 'Expanded public waste-collection coverage to 95% of households', 'Waste-collection coverage expanded to 95% of households, with strengthened private collection systems for businesses.', 'Environment', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review', 'For most households, this means garbage actually gets collected reliably instead of piling up or being burned/dumped informally — a basic, everyday quality-of-life issue.');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('2e997d44-8f65-4645-9b91-5d9a3ca55940', '3dba96c7-1983-48af-b61a-ffd834f5850f');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('2e997d44-8f65-4645-9b91-5d9a3ca55940', 'c24cd251-2d47-4d9a-89f2-deae70523406');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status, citizen_impact)
VALUES ('055c017d-6d6f-4ef1-b140-ce9c6b7c5084', 'accomplishment', 'Waived import duties on approved single-use plastic alternatives', 'Duty waiver on approved alternatives to single-use plastics runs January 2025 through December 2027.', 'Environment', '2025-01-01', 2025, 'claude_vision_manual', 'medium', 'pending_review', 'Makes eco-friendly packaging cheaper for local businesses to import, which should help keep prices from rising for shoppers as the plastics ban rolls out.');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('055c017d-6d6f-4ef1-b140-ce9c6b7c5084', '3dba96c7-1983-48af-b61a-ffd834f5850f');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('055c017d-6d6f-4ef1-b140-ce9c6b7c5084', 'c24cd251-2d47-4d9a-89f2-deae70523406');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status, citizen_impact)
VALUES ('80612931-fd78-49d0-8217-1779c44afc70', 'accomplishment', 'Reviewed and amended laws decriminalizing marijuana possession and cultivation', 'Laws reviewed and amended to decriminalize possession and cultivation of marijuana.', 'Governance', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review', 'Directly affects anyone who previously risked a criminal record for small-scale possession or growing — this is a real, personal legal-status change for many citizens, not just a policy statement.');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('80612931-fd78-49d0-8217-1779c44afc70', '3dba96c7-1983-48af-b61a-ffd834f5850f');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('80612931-fd78-49d0-8217-1779c44afc70', 'c24cd251-2d47-4d9a-89f2-deae70523406');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status, citizen_impact)
VALUES ('b7081948-658e-41a3-835c-1c2bb30edb65', 'accomplishment', 'Invested EC$63.5 million to stabilize electricity prices', 'Investment included EC$12 million to subsidize gas, EC$40 million for two 18MW hybrid generators, and a temporary 6MW generator to stabilize the grid.', 'Energy', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review', 'This is the reason your electricity bill hasn''t spiked as hard as fuel costs have risen elsewhere — it''s a direct subsidy keeping your monthly power bill lower than it would otherwise be.');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('b7081948-658e-41a3-835c-1c2bb30edb65', '0ca5fb89-c649-4984-9ea2-4088554741bf');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('b7081948-658e-41a3-835c-1c2bb30edb65', 'f741113b-eaf7-44af-82bd-5977a68d377f');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status, citizen_impact)
VALUES ('b0dbf7f8-d98e-4b1b-81af-58cf9751ac00', 'accomplishment', 'Increased the national Water Budget by over 400% and reactivated the Water Board', 'Water Budget increased more than 400%, alongside reactivation of the previously dormant Water Board.', 'Water', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review', 'This is the funding behind visible water projects — new tanks, wells, and pipelines — the budget increase itself is what makes those visible fixes possible.');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('b0dbf7f8-d98e-4b1b-81af-58cf9751ac00', '0ca5fb89-c649-4984-9ea2-4088554741bf');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('b0dbf7f8-d98e-4b1b-81af-58cf9751ac00', 'f741113b-eaf7-44af-82bd-5977a68d377f');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status, citizen_impact)
VALUES ('a268fd6f-4088-418a-938d-aa4380e220c6', 'accomplishment', 'Advanced major desalination projects including a 2-million-gallon-per-day Basseterre plant', 'Advanced desalination integration into Frigate Bay/Southeast Peninsula systems, the Canada Industrial Site plant (700,000 gal/day with the UAE), and the Basseterre Desalination Plant (2 million gal/day).', 'Water', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review', 'Long run: this is the infrastructure meant to finally end the on-and-off water rationing many households have dealt with for years — desalination capacity at this scale is what a genuine fix looks like, not a quick patch.');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('a268fd6f-4088-418a-938d-aa4380e220c6', '0ca5fb89-c649-4984-9ea2-4088554741bf');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('a268fd6f-4088-418a-938d-aa4380e220c6', 'f741113b-eaf7-44af-82bd-5977a68d377f');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status, citizen_impact)
VALUES ('7f7305d3-a7a0-4e12-8c49-35028c1cdd69', 'accomplishment', 'Identified 17 potential groundwater drilling sites via drone survey', 'Drone-based geophysical surveys identified 17 priority groundwater sites across Saddlers, Sandy Point, Newton Ground, St. Paul''s, Parsons, Dieppe Bay, Tabernacle, Molineux, Cayon, Challengers, Belle View, Stone Fort and Old Road.', 'Water', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review', 'If you live in one of these named communities, this is the groundwork (literally) for a new water source specifically for your area — worth watching for follow-up news on which sites actually get developed.');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('7f7305d3-a7a0-4e12-8c49-35028c1cdd69', '0ca5fb89-c649-4984-9ea2-4088554741bf');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('7f7305d3-a7a0-4e12-8c49-35028c1cdd69', 'f741113b-eaf7-44af-82bd-5977a68d377f');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status, citizen_impact)
VALUES ('31d7ba55-0d31-4628-a806-464fd76a5bc1', 'accomplishment', 'Reconnected eligible Water Services Department customers through the RESET', 'Eligible residential customers reconnected to water services through the Water Services RESET programme in 2023.', 'Water', '2023-01-01', 2023, 'claude_vision_manual', 'medium', 'pending_review', 'If your household had water service disconnected over unpaid arrears, this programme was a direct route back to reconnection — immediate relief, not a long-term policy.');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('31d7ba55-0d31-4628-a806-464fd76a5bc1', '09688dc4-fee9-4584-9327-5393e9826e7e');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('31d7ba55-0d31-4628-a806-464fd76a5bc1', '20131ac3-de75-4372-959a-7d82dc4aeb4d');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status, citizen_impact)
VALUES ('ba8a6b48-6729-4a75-b2bd-17b33180a42c', 'accomplishment', 'Established a centralized export marketing agency for farm and seafood goods', 'A centralized agency was established to market and export locally produced farm and seafood goods.', 'Agriculture', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review', 'For local farmers and fishers, this means an easier, more reliable path to sell produce beyond the local market — potentially more income without having to find buyers yourself.');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('ba8a6b48-6729-4a75-b2bd-17b33180a42c', '09688dc4-fee9-4584-9327-5393e9826e7e');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('ba8a6b48-6729-4a75-b2bd-17b33180a42c', '20131ac3-de75-4372-959a-7d82dc4aeb4d');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status, citizen_impact)
VALUES ('32eb3698-5443-4e4a-a2aa-fa6a32ff64e7', 'accomplishment', 'Expanded farmer market access via an online public market platform', 'Public Market added to 869ToGo.com, enabling online purchases of locally produced fruits and vegetables.', 'Agriculture', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review', 'For shoppers, this means you can now buy local produce online instead of only at a physical market. For farmers, it''s a new, lower-effort sales channel.');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('32eb3698-5443-4e4a-a2aa-fa6a32ff64e7', '09688dc4-fee9-4584-9327-5393e9826e7e');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('32eb3698-5443-4e4a-a2aa-fa6a32ff64e7', '20131ac3-de75-4372-959a-7d82dc4aeb4d');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status, citizen_impact)
VALUES ('534b4528-d7b4-4177-b4c5-4fc8b84eea46', 'accomplishment', 'Partnered with Taiwan to establish a 20,000-bird poultry farm', 'Farm capable of producing 20,000 laying birds annually, plus a hatchery, broiler production, and a poultry slaughtering facility to reduce dependence on roughly EC$20 million in chicken imports.', 'Agriculture', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review', 'Long run: this is aimed at bringing chicken prices down over time by reducing reliance on imports — a real, if gradual, cost-of-living effect at the grocery store.');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('534b4528-d7b4-4177-b4c5-4fc8b84eea46', '10e8b24e-4cc8-4058-b5c3-d95a1f780434');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('534b4528-d7b4-4177-b4c5-4fc8b84eea46', '3819ab2b-8ec7-4cd3-a36a-63d4c5954ed4');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status, citizen_impact)
VALUES ('7c0edce5-32b4-4436-956c-ee596b6fc95e', 'accomplishment', 'Assisted more than 700 farmers with irrigation and climate-resilience support', 'Support included irrigation systems, solar pumps, ground cover, and water tanks, plus free distribution of 150,000 pineapple slips, 60,000 banana slips, and thousands of tomato slips.', 'Agriculture', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review', 'If you''re one of the 700+ farmers assisted, this is direct, tangible support reducing your costs and risk from drought — for everyone else, more resilient local farms mean more stable local food prices.');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('7c0edce5-32b4-4436-956c-ee596b6fc95e', '10e8b24e-4cc8-4058-b5c3-d95a1f780434');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('7c0edce5-32b4-4436-956c-ee596b6fc95e', '3819ab2b-8ec7-4cd3-a36a-63d4c5954ed4');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status, citizen_impact)
VALUES ('667350c0-605c-448c-8392-a9543bbdbb46', 'accomplishment', 'Installed 17 cold-storage facilities for farmers', 'Includes two walk-in chillers at Tabernacle and 15 cold containers, plus a new agro-processing unit to convert substandard crops into value-added products.', 'Agriculture', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review', 'Helps farmers avoid losing unsold produce to spoilage — less waste for them, and potentially more consistent local produce availability for you.');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('667350c0-605c-448c-8392-a9543bbdbb46', '10e8b24e-4cc8-4058-b5c3-d95a1f780434');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('667350c0-605c-448c-8392-a9543bbdbb46', '3819ab2b-8ec7-4cd3-a36a-63d4c5954ed4');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status, citizen_impact)
VALUES ('faee120c-0b7f-48ab-bda4-04accb1e8265', 'accomplishment', 'Recorded significant crop-production increases across key crops', 'Production increases recorded of 77% for melons, 52% for peppers, over 100% for pineapples, and over 50% for cabbage.', 'Agriculture', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review', 'More local produce grown here generally means more availability and potentially better prices for these items at the market, rather than relying on imports.');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('faee120c-0b7f-48ab-bda4-04accb1e8265', '6348728c-338b-46d6-9cc2-5c5eca0dfaff');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('faee120c-0b7f-48ab-bda4-04accb1e8265', 'b5942eaf-311e-4e4b-b68f-a6e863188cff');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status, citizen_impact)
VALUES ('2a71cda7-7f88-420c-93d2-286e111dee20', 'accomplishment', 'Hosted the 2025 Global Sustainable Islands Summit', 'Summit hosted May 27-29, 2025, positioning the Federation in international sustainability discussions.', 'Environment', '2025-05-27', 2025, 'claude_vision_manual', 'medium', 'pending_review', 'Less a direct citizen benefit than a reputational/economic one — hosting events like this can attract investment and tourism attention tied to the country''s sustainability image.');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('2a71cda7-7f88-420c-93d2-286e111dee20', '6348728c-338b-46d6-9cc2-5c5eca0dfaff');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('2a71cda7-7f88-420c-93d2-286e111dee20', 'b5942eaf-311e-4e4b-b68f-a6e863188cff');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status, citizen_impact)
VALUES ('e5fbe06e-2e80-4d85-93a3-1c70b375abfc', 'accomplishment', 'Enacted the Plastic Waste Reduction Act, 2025', 'Establishes the phased ban on single-use plastics, mandated biodegradable alternatives, import licensing and enforcement penalties (the legal basis for the plastics ban noted above).', 'Environment', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review', 'This is the actual law behind the plastics changes at the store — worth knowing it''s now a legal requirement, not just a voluntary government campaign.');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('e5fbe06e-2e80-4d85-93a3-1c70b375abfc', '6348728c-338b-46d6-9cc2-5c5eca0dfaff');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('e5fbe06e-2e80-4d85-93a3-1c70b375abfc', 'b5942eaf-311e-4e4b-b68f-a6e863188cff');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status, citizen_impact)
VALUES ('b0a56831-e71a-44a1-9154-60f932368202', 'accomplishment', 'Subsidized the Fuel Variation Charge, saving households an average of EC$2,125', 'FVC subsidy for all Saint Kitts households has saved each residential customer an average of approximately EC$2,125 since November 2022.', 'Energy', '2022-11-01', 2022, 'claude_vision_manual', 'medium', 'pending_review', 'This is a concrete number you can compare against your own electricity bills since late 2022 — the subsidy is a big part of why your power costs haven''t tracked global fuel price spikes directly.');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('b0a56831-e71a-44a1-9154-60f932368202', '30532a63-b388-4e9b-93d1-b5c834499120');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('b0a56831-e71a-44a1-9154-60f932368202', 'c7092f22-6083-4679-971b-c7b66a719dfe');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status, citizen_impact)
VALUES ('d8bdd63e-6d34-42f8-8691-200bf0400a06', 'accomplishment', 'Introduced SOLARISE net-billing for solar households', 'Allows solar households to sell excess electricity back to the grid at 11 cents per kWh, alongside zero taxes on solar systems through Dec 31 2026 and reduced EV import duty (45% to 10% from May 2026).', 'Energy', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review', 'If you''re considering solar panels, this makes the investment pay back faster — you can actually earn money selling surplus power, not just offset your own bill.');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('d8bdd63e-6d34-42f8-8691-200bf0400a06', '30532a63-b388-4e9b-93d1-b5c834499120');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('d8bdd63e-6d34-42f8-8691-200bf0400a06', 'c7092f22-6083-4679-971b-c7b66a719dfe');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status, citizen_impact)
VALUES ('32782b2e-3712-4100-959c-38c0cc5bc5e1', 'accomplishment', 'Initiated plans for a 50MW solar plant with battery storage', 'Plans advanced with procurement support from Taiwan, alongside a 70,000-gallon-per-day solar desalination plant.', 'Energy', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review', 'Long run: this is a step toward more of the country''s electricity coming from solar rather than imported fuel, which over years should mean more stable prices less exposed to global oil price swings.');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('32782b2e-3712-4100-959c-38c0cc5bc5e1', '30532a63-b388-4e9b-93d1-b5c834499120');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('32782b2e-3712-4100-959c-38c0cc5bc5e1', 'c7092f22-6083-4679-971b-c7b66a719dfe');
