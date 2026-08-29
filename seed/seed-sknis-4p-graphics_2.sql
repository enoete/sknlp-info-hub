-- ============================================================
-- Seed batch: SKNIS "4P" campaign graphics, first-pass extraction
-- Source: images provided directly in the project, read and
-- paraphrased by Claude (not OCR + separate LLM step, one pass).
-- All rows land as pending_review — nothing here is auto-approved.
-- Requires the actual image files present at seed/images/<filename>
-- before proof_documents.file_url will resolve to anything real —
-- scp them over first. This is a FIRST PASS, not exhaustive: each
-- image contains more items than extracted here.
-- ============================================================

-- ---- Image: 4p-education-1.jpeg ----
INSERT INTO sources (id, source_type, channel, title, speaker_org, origin_url, published_at)
VALUES ('e3db6228-bd8a-4098-9208-52d4b7e589df', 'official_govt', 'social_post', 'SKNIS "4P" campaign graphic — 4p-education-1.jpeg', 'SKNIS', 'https://www.facebook.com/sknismedia/photos', NULL);

INSERT INTO proof_documents (id, file_url, file_type, title, uploaded_at)
VALUES ('3ff47ff2-0398-4f61-a878-474bcb9259e1', 'seed/images/4p-education-1.jpeg', 'jpeg', 'SKNIS 4P graphic: 4p-education-1.jpeg', now());

-- ---- Image: 4p-government-1.jpeg ----
INSERT INTO sources (id, source_type, channel, title, speaker_org, origin_url, published_at)
VALUES ('41ba8642-d24a-4720-9efd-8fd2d7c9ed6d', 'official_govt', 'social_post', 'SKNIS "4P" campaign graphic — 4p-government-1.jpeg', 'SKNIS', 'https://www.facebook.com/sknismedia/photos', NULL);

INSERT INTO proof_documents (id, file_url, file_type, title, uploaded_at)
VALUES ('a7f9aa7f-3a96-4152-9cfd-6355234efd5f', 'seed/images/4p-government-1.jpeg', 'jpeg', 'SKNIS 4P graphic: 4p-government-1.jpeg', now());

-- ---- Image: 4p-government-2.jpeg ----
INSERT INTO sources (id, source_type, channel, title, speaker_org, origin_url, published_at)
VALUES ('8312d3d4-91ec-4b92-92aa-3ba9f163b5d9', 'official_govt', 'social_post', 'SKNIS "4P" campaign graphic — 4p-government-2.jpeg', 'SKNIS', 'https://www.facebook.com/sknismedia/photos', NULL);

INSERT INTO proof_documents (id, file_url, file_type, title, uploaded_at)
VALUES ('827a0884-2c3f-4c8a-b118-a074e52413ae', 'seed/images/4p-government-2.jpeg', 'jpeg', 'SKNIS 4P graphic: 4p-government-2.jpeg', now());

-- ---- Image: 4p-housing-1.jpeg ----
INSERT INTO sources (id, source_type, channel, title, speaker_org, origin_url, published_at)
VALUES ('626ded2b-79e6-4bc5-aa45-3de04e8d27a1', 'official_govt', 'social_post', 'SKNIS "4P" campaign graphic — 4p-housing-1.jpeg', 'SKNIS', 'https://www.facebook.com/sknismedia/photos', NULL);

INSERT INTO proof_documents (id, file_url, file_type, title, uploaded_at)
VALUES ('466e672c-6942-48c7-8f86-a6efde6e23b3', 'seed/images/4p-housing-1.jpeg', 'jpeg', 'SKNIS 4P graphic: 4p-housing-1.jpeg', now());

-- ---- Image: 4p-government-3.jpeg ----
INSERT INTO sources (id, source_type, channel, title, speaker_org, origin_url, published_at)
VALUES ('1e4321f3-540a-4f93-9e2b-9e1e43b972a4', 'official_govt', 'social_post', 'SKNIS "4P" campaign graphic — 4p-government-3.jpeg', 'SKNIS', 'https://www.facebook.com/sknismedia/photos', NULL);

INSERT INTO proof_documents (id, file_url, file_type, title, uploaded_at)
VALUES ('9f1368ad-d10f-4ae6-9e70-dffabafa606e', 'seed/images/4p-government-3.jpeg', 'jpeg', 'SKNIS 4P graphic: 4p-government-3.jpeg', now());

-- ---- Image: 4p-education-2.jpeg ----
INSERT INTO sources (id, source_type, channel, title, speaker_org, origin_url, published_at)
VALUES ('aab1f63f-d953-49ff-b7a9-12f406503b4d', 'official_govt', 'social_post', 'SKNIS "4P" campaign graphic — 4p-education-2.jpeg', 'SKNIS', 'https://www.facebook.com/sknismedia/photos', NULL);

INSERT INTO proof_documents (id, file_url, file_type, title, uploaded_at)
VALUES ('1ee8fed0-904d-47f7-9236-cc49b69b16a2', 'seed/images/4p-education-2.jpeg', 'jpeg', 'SKNIS 4P graphic: 4p-education-2.jpeg', now());

-- ---- Image: 4p-housing-2.jpeg ----
INSERT INTO sources (id, source_type, channel, title, speaker_org, origin_url, published_at)
VALUES ('9f11f971-be11-4ebc-bbe4-7c86a5615e6d', 'official_govt', 'social_post', 'SKNIS "4P" campaign graphic — 4p-housing-2.jpeg', 'SKNIS', 'https://www.facebook.com/sknismedia/photos', NULL);

INSERT INTO proof_documents (id, file_url, file_type, title, uploaded_at)
VALUES ('7a0e8746-bae0-4ed1-8648-e87eb435dec3', 'seed/images/4p-housing-2.jpeg', 'jpeg', 'SKNIS 4P graphic: 4p-housing-2.jpeg', now());

-- ---- Image: 4p-sports-1.jpeg ----
INSERT INTO sources (id, source_type, channel, title, speaker_org, origin_url, published_at)
VALUES ('07139682-c59f-460a-942a-8bc18e020968', 'official_govt', 'social_post', 'SKNIS "4P" campaign graphic — 4p-sports-1.jpeg', 'SKNIS', 'https://www.facebook.com/sknismedia/photos', NULL);

INSERT INTO proof_documents (id, file_url, file_type, title, uploaded_at)
VALUES ('bf0decb1-5ed8-424d-bba6-5757803a4c49', 'seed/images/4p-sports-1.jpeg', 'jpeg', 'SKNIS 4P graphic: 4p-sports-1.jpeg', now());

-- ---- Image: 4p-education-3.jpeg ----
INSERT INTO sources (id, source_type, channel, title, speaker_org, origin_url, published_at)
VALUES ('c780bbde-0a97-407d-a0a7-8f87dad7ce53', 'official_govt', 'social_post', 'SKNIS "4P" campaign graphic — 4p-education-3.jpeg', 'SKNIS', 'https://www.facebook.com/sknismedia/photos', NULL);

INSERT INTO proof_documents (id, file_url, file_type, title, uploaded_at)
VALUES ('5d1a478d-d285-4a02-822d-cc96c2637ded', 'seed/images/4p-education-3.jpeg', 'jpeg', 'SKNIS 4P graphic: 4p-education-3.jpeg', now());

-- ---- Image: 4p-government-4.jpeg ----
INSERT INTO sources (id, source_type, channel, title, speaker_org, origin_url, published_at)
VALUES ('a91ca7fb-23b5-40ce-b03b-36b757a30bc1', 'official_govt', 'social_post', 'SKNIS "4P" campaign graphic — 4p-government-4.jpeg', 'SKNIS', 'https://www.facebook.com/sknismedia/photos', NULL);

INSERT INTO proof_documents (id, file_url, file_type, title, uploaded_at)
VALUES ('66c22371-8da2-4ef6-8069-b788a14bb0d4', 'seed/images/4p-government-4.jpeg', 'jpeg', 'SKNIS 4P graphic: 4p-government-4.jpeg', now());

-- ---- Image: 4p-housing-3.jpeg ----
INSERT INTO sources (id, source_type, channel, title, speaker_org, origin_url, published_at)
VALUES ('c540b4d6-7a9f-4b5f-8795-4f620ca178f4', 'official_govt', 'social_post', 'SKNIS "4P" campaign graphic — 4p-housing-3.jpeg', 'SKNIS', 'https://www.facebook.com/sknismedia/photos', NULL);

INSERT INTO proof_documents (id, file_url, file_type, title, uploaded_at)
VALUES ('d9433244-7274-472f-9829-1c377d6addd7', 'seed/images/4p-housing-3.jpeg', 'jpeg', 'SKNIS 4P graphic: 4p-housing-3.jpeg', now());

-- ---- Image: 4p-housing-4.jpeg ----
INSERT INTO sources (id, source_type, channel, title, speaker_org, origin_url, published_at)
VALUES ('58979992-477f-4f73-a29f-34e6cba9745f', 'official_govt', 'social_post', 'SKNIS "4P" campaign graphic — 4p-housing-4.jpeg', 'SKNIS', 'https://www.facebook.com/sknismedia/photos', NULL);

INSERT INTO proof_documents (id, file_url, file_type, title, uploaded_at)
VALUES ('f6d9edfa-7a72-49be-a7de-f0b11410c620', 'seed/images/4p-housing-4.jpeg', 'jpeg', 'SKNIS 4P graphic: 4p-housing-4.jpeg', now());

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('c4d4909a-2f59-4249-a52e-06afdbc4eba2', 'accomplishment', 'Expanded scholarships for university, vocational, and professional development', 'Scholarships expanded to cover university education, professional development, vocational training and apprenticeships.', 'Education', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('c4d4909a-2f59-4249-a52e-06afdbc4eba2', 'e3db6228-bd8a-4098-9208-52d4b7e589df');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('c4d4909a-2f59-4249-a52e-06afdbc4eba2', '3ff47ff2-0398-4f61-a878-474bcb9259e1');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('522b7bb2-0968-4a5e-8644-c7d62d66b48b', 'accomplishment', 'Awarded six fully funded scholarships to civil servants', 'Six fully funded scholarships awarded to civil servants through the Ministry of Sustainable Development.', 'Education', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('522b7bb2-0968-4a5e-8644-c7d62d66b48b', 'e3db6228-bd8a-4098-9208-52d4b7e589df');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('522b7bb2-0968-4a5e-8644-c7d62d66b48b', '3ff47ff2-0398-4f61-a878-474bcb9259e1');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('1d45f29d-3369-45ba-9e3a-0f87eece73e4', 'accomplishment', 'Expanded social protection via Pensions and GAE amendment acts', 'Social protection expanded through the Pensions (Amendment) Act 2025 and the Government Auxiliary Employees (Amendment) Act 2025, plus amendments to the Housing and Social Development Levy Act.', 'Governance', '2025-01-01', 2025, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('1d45f29d-3369-45ba-9e3a-0f87eece73e4', '41ba8642-d24a-4720-9efd-8fd2d7c9ed6d');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('1d45f29d-3369-45ba-9e3a-0f87eece73e4', 'a7f9aa7f-3a96-4152-9cfd-6355234efd5f');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('abed2119-5c0a-43c1-b6c2-bdc4a0468e52', 'accomplishment', 'Advanced health, agriculture and environmental protection legislation', 'Advanced protections via the Medical Laboratories Act 2024, Plant Protection Act 2024, Animal Health Act 2024, Radiation Safety and Security Act 2024, and Plastic Waste Reduction Act 2025.', 'Environment', '2024-01-01', 2024, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('abed2119-5c0a-43c1-b6c2-bdc4a0468e52', '41ba8642-d24a-4720-9efd-8fd2d7c9ed6d');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('abed2119-5c0a-43c1-b6c2-bdc4a0468e52', 'a7f9aa7f-3a96-4152-9cfd-6355234efd5f');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('968d2e41-e423-4ff8-8d39-01a903278651', 'accomplishment', 'Launched Electronic Travel Authorisation (eTA) bio corridor system', 'Launched an eTA bio corridor system developed with Swiss tech firm Travizory, free to nationals and OECS/CARICOM citizens, intended to speed immigration and improve border security screening.', 'Governance', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('968d2e41-e423-4ff8-8d39-01a903278651', '8312d3d4-91ec-4b92-92aa-3ba9f163b5d9');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('968d2e41-e423-4ff8-8d39-01a903278651', '827a0884-2c3f-4c8a-b118-a074e52413ae');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('422fd5e6-b18f-46b4-bb94-3cffc11e22be', 'accomplishment', 'Installed the Federation''s first female Governor-General', 'Dame Marcella Liburd GCMG, JP installed as the Federation''s first female Governor-General.', 'Governance', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('422fd5e6-b18f-46b4-bb94-3cffc11e22be', '8312d3d4-91ec-4b92-92aa-3ba9f163b5d9');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('422fd5e6-b18f-46b4-bb94-3cffc11e22be', '827a0884-2c3f-4c8a-b118-a074e52413ae');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('9476bd3b-8d6d-4da9-b949-b4a165676345', 'accomplishment', 'Activated the Electoral Boundaries Commission and appointed a Supervisor of Elections', 'The Electoral Boundaries Commission was activated and a Supervisor of Elections was appointed.', 'Governance', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('9476bd3b-8d6d-4da9-b949-b4a165676345', '8312d3d4-91ec-4b92-92aa-3ba9f163b5d9');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('9476bd3b-8d6d-4da9-b949-b4a165676345', '827a0884-2c3f-4c8a-b118-a074e52413ae');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('cfa611ea-15ab-45bd-b3df-342ca58ccd12', 'accomplishment', 'Enacted the Vehicle and Road Traffic (Amendment) Act 2025', 'Increased penalties for dangerous and impaired driving, establishing the first legislative measure under the Sustainable Road Safety Project.', 'Governance', '2025-01-01', 2025, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('cfa611ea-15ab-45bd-b3df-342ca58ccd12', '8312d3d4-91ec-4b92-92aa-3ba9f163b5d9');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('cfa611ea-15ab-45bd-b3df-342ca58ccd12', '827a0884-2c3f-4c8a-b118-a074e52413ae');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('9354f188-eed2-4fc5-bd63-7640f37d3d11', 'accomplishment', 'Tabled the Federation''s first National Disability Policy', 'Tabled the first National Disability Policy, establishing a 2026-2030 framework for accessibility, education, healthcare, employment, social protection and disability rights.', 'Social Protection', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('9354f188-eed2-4fc5-bd63-7640f37d3d11', '626ded2b-79e6-4bc5-aa45-3de04e8d27a1');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('9354f188-eed2-4fc5-bd63-7640f37d3d11', '466e672c-6942-48c7-8f86-a6efde6e23b3');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('8852a2bd-05ee-4544-890e-baa85d99db80', 'accomplishment', 'Launched "Voice It" AI legal assistant', 'An AI-driven legal assistant developed with Churami Limited, intended to provide instant guidance on laws and legal processes.', 'Governance', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('8852a2bd-05ee-4544-890e-baa85d99db80', '1e4321f3-540a-4f93-9e2b-9e1e43b972a4');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('8852a2bd-05ee-4544-890e-baa85d99db80', '9f1368ad-d10f-4ae6-9e70-dffabafa606e');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('8eac1a76-dc87-48a3-956c-fdcfc3743c57', 'accomplishment', 'Restarted the K9 Unit and expanded the police vehicle fleet', 'Restarted the K9 Unit with new police dogs, and added six new vehicles to the Royal St. Christopher and Nevis Police Force plus four more to the Nevis Division.', 'Security', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('8eac1a76-dc87-48a3-956c-fdcfc3743c57', '1e4321f3-540a-4f93-9e2b-9e1e43b972a4');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('8eac1a76-dc87-48a3-956c-fdcfc3743c57', '9f1368ad-d10f-4ae6-9e70-dffabafa606e');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('65e1ad59-fb1d-4505-8756-2365b20ea0c2', 'accomplishment', 'Advanced 80+ legislative measures since 2022', 'Legislative program included the Anti-Corruption Act, amendments to the Integrity in Public Life Act and Freedom of Information Act, whistleblower protection reforms, the Plea Negotiations and Agreements Act 2025, the Judge Alone Trials Act 2024, and the Voluntary Bill of Indictment Act 2024.', 'Governance', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('65e1ad59-fb1d-4505-8756-2365b20ea0c2', '1e4321f3-540a-4f93-9e2b-9e1e43b972a4');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('65e1ad59-fb1d-4505-8756-2365b20ea0c2', '9f1368ad-d10f-4ae6-9e70-dffabafa606e');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('8c6c83cd-a23e-4ff0-bcbd-29a72b0f3891', 'accomplishment', 'Commenced construction of the new Basseterre High School on its original site', 'Construction of the new Basseterre High School began on its original historic site.', 'Education', '2022-08-05', 2022, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('8c6c83cd-a23e-4ff0-bcbd-29a72b0f3891', 'aab1f63f-d953-49ff-b7a9-12f406503b4d');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('8c6c83cd-a23e-4ff0-bcbd-29a72b0f3891', '1ee8fed0-904d-47f7-9236-cc49b69b16a2');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('011ae6af-a93f-4d03-9b8e-9b1067e08603', 'accomplishment', 'Constructed a new Joshua Obadiah Williams Primary School in Molineux', 'A new Joshua Obadiah Williams Primary School was constructed in Molineux.', 'Education', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('011ae6af-a93f-4d03-9b8e-9b1067e08603', 'aab1f63f-d953-49ff-b7a9-12f406503b4d');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('011ae6af-a93f-4d03-9b8e-9b1067e08603', '1ee8fed0-904d-47f7-9236-cc49b69b16a2');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('5b91dd55-0ae7-4b45-8ed5-05429d70bed8', 'accomplishment', 'Launched the Christopher-Wilkin Institute of Technology (CWIT)', 'CWIT was formed as a strategic merger of the Advanced Vocational Education Centre, Project Strong, and the National Skills Training Programme, intended to transform vocational education delivery.', 'Education', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('5b91dd55-0ae7-4b45-8ed5-05429d70bed8', 'aab1f63f-d953-49ff-b7a9-12f406503b4d');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('5b91dd55-0ae7-4b45-8ed5-05429d70bed8', '1ee8fed0-904d-47f7-9236-cc49b69b16a2');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('b8ecc083-07f4-46a6-b542-be738514c9fe', 'accomplishment', 'Enabled 0% down payment mortgages from indigenous financial institutions', 'Citizens enabled to access mortgages from indigenous financial institutions with a 0% down payment requirement.', 'Housing', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('b8ecc083-07f4-46a6-b542-be738514c9fe', '9f11f971-be11-4ebc-bbe4-7c86a5615e6d');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('b8ecc083-07f4-46a6-b542-be738514c9fe', '7a0e8746-bae0-4ed1-8648-e87eb435dec3');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('22f25889-242a-4b49-aeee-dbd1647ec2dc', 'accomplishment', 'Granted duty-free concessions on building materials for renovations', 'Duty-free concessions granted on building materials for renovations and repairs, effective September 2023.', 'Housing', '2023-09-01', 2023, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('22f25889-242a-4b49-aeee-dbd1647ec2dc', '9f11f971-be11-4ebc-bbe4-7c86a5615e6d');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('22f25889-242a-4b49-aeee-dbd1647ec2dc', '7a0e8746-bae0-4ed1-8648-e87eb435dec3');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('a861ddb9-4239-4953-a520-35c3a0f40e26', 'accomplishment', 'Approved the Whitegate Development Plan for northwest Saint Kitts', 'Plan incorporates 66 residential and commercial lots at Brotherson Estate, plus expansion of Ramada by Wyndham, Eco Park redevelopment, and fisheries/transport improvements.', 'Housing', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('a861ddb9-4239-4953-a520-35c3a0f40e26', '9f11f971-be11-4ebc-bbe4-7c86a5615e6d');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('a861ddb9-4239-4953-a520-35c3a0f40e26', '7a0e8746-bae0-4ed1-8648-e87eb435dec3');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('091dc829-7034-494e-aaa4-ee902ba67b0a', 'accomplishment', 'Delivered over 800 housing solutions', 'More than 800 housing solutions provided, with several hundred more under construction or nearing completion.', 'Housing', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('091dc829-7034-494e-aaa4-ee902ba67b0a', '9f11f971-be11-4ebc-bbe4-7c86a5615e6d');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('091dc829-7034-494e-aaa4-ee902ba67b0a', '7a0e8746-bae0-4ed1-8648-e87eb435dec3');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('42603416-46f9-43dc-803b-5d6fdec36da0', 'accomplishment', 'Officially launched the Ministry of Creative Economy', 'A dedicated Ministry of Creative Economy was launched to support growth and business opportunities for local artistes.', 'Other', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('42603416-46f9-43dc-803b-5d6fdec36da0', '07139682-c59f-460a-942a-8bc18e020968');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('42603416-46f9-43dc-803b-5d6fdec36da0', 'bf0decb1-5ed8-424d-bba6-5757803a4c49');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('b94d7a57-cb64-49a7-b978-963d81c86838', 'accomplishment', 'Renovated Kim Collins Athletic Stadium and Basketball City', 'Completed renovations of the Kim Collins Athletic Stadium (including a new running track) and Basketball City, plus construction of a new football stadium in Conaree.', 'Other', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('b94d7a57-cb64-49a7-b978-963d81c86838', '07139682-c59f-460a-942a-8bc18e020968');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('b94d7a57-cb64-49a7-b978-963d81c86838', 'bf0decb1-5ed8-424d-bba6-5757803a4c49');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('9d2e2233-9ab7-4335-9c09-44b264b0558c', 'accomplishment', 'Introduced STEAM education in primary schools', 'STEAM (science, technology, engineering, arts, mathematics) education introduced in primary schools.', 'Education', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('9d2e2233-9ab7-4335-9c09-44b264b0558c', 'c780bbde-0a97-407d-a0a7-8f87dad7ce53');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('9d2e2233-9ab7-4335-9c09-44b264b0558c', '5d1a478d-d285-4a02-822d-cc96c2637ded');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('5c93188a-a0b9-45a3-9652-2c061c4738d0', 'accomplishment', 'Reinstated the One-to-One Laptop Programme', 'The One-to-One Laptop Programme was reinstated, alongside tablets provided to primary school students.', 'Education', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('5c93188a-a0b9-45a3-9652-2c061c4738d0', 'c780bbde-0a97-407d-a0a7-8f87dad7ce53');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('5c93188a-a0b9-45a3-9652-2c061c4738d0', '5d1a478d-d285-4a02-822d-cc96c2637ded');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('f100ec56-d827-4817-ab59-3c2c19a86b8c', 'accomplishment', 'Provided EC$25,000 grants for undergraduate/graduate study in priority fields', 'A grant of EC$25,000 offered to every student pursuing undergraduate or graduate studies in a field immediately relevant to national development.', 'Education', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('f100ec56-d827-4817-ab59-3c2c19a86b8c', 'c780bbde-0a97-407d-a0a7-8f87dad7ce53');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('f100ec56-d827-4817-ab59-3c2c19a86b8c', '5d1a478d-d285-4a02-822d-cc96c2637ded');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('0f565788-97af-4d13-9441-8e544899da30', 'accomplishment', 'Signed a visa-exemption agreement with Ghana', 'Agreement signed to expand travel, tourism, business, education and cultural exchange between the two countries; also co-sponsored the UN resolution recognising the transatlantic slave trade.', 'Governance', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('0f565788-97af-4d13-9441-8e544899da30', 'a91ca7fb-23b5-40ce-b03b-36b757a30bc1');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('0f565788-97af-4d13-9441-8e544899da30', '66c22371-8da2-4ef6-8069-b788a14bb0d4');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('3264a3cb-51d7-43d2-9f8f-162a46aeac33', 'accomplishment', 'Launched the SMARTS Tax Administration system', 'System launched for online filing and payment, real-time updates and enhanced security, alongside digitized Customs and Excise services.', 'Governance', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('3264a3cb-51d7-43d2-9f8f-162a46aeac33', 'a91ca7fb-23b5-40ce-b03b-36b757a30bc1');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('3264a3cb-51d7-43d2-9f8f-162a46aeac33', '66c22371-8da2-4ef6-8069-b788a14bb0d4');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('536631fb-c90e-4a30-96ed-515c8062c6e4', 'accomplishment', 'Secured restoration of limited Canadian visa-free access', 'Restoration secured for eligible categories of Saint Kitts and Nevis nationals.', 'Governance', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('536631fb-c90e-4a30-96ed-515c8062c6e4', 'a91ca7fb-23b5-40ce-b03b-36b757a30bc1');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('536631fb-c90e-4a30-96ed-515c8062c6e4', '66c22371-8da2-4ef6-8069-b788a14bb0d4');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('b7363857-d36f-43a7-883f-0e8e2cf668b7', 'accomplishment', 'Increased monthly Social Security pensions', 'Contributory pensions increased from EC$430 to EC$500, and non-contributory pensions from EC$250 to EC$350, effective January 2024.', 'Social Protection', '2024-01-01', 2024, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('b7363857-d36f-43a7-883f-0e8e2cf668b7', 'c540b4d6-7a9f-4b5f-8795-4f620ca178f4');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('b7363857-d36f-43a7-883f-0e8e2cf668b7', 'd9433244-7274-472f-9829-1c377d6addd7');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('2c671c93-df1c-4af8-ba4e-694a07feb4c7', 'accomplishment', 'Increased the Funeral Grant by 40%', 'Funeral Grant increased from EC$2,500 to EC$3,500, effective January 2024.', 'Social Protection', '2024-01-01', 2024, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('2c671c93-df1c-4af8-ba4e-694a07feb4c7', 'c540b4d6-7a9f-4b5f-8795-4f620ca178f4');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('2c671c93-df1c-4af8-ba4e-694a07feb4c7', 'd9433244-7274-472f-9829-1c377d6addd7');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('fbef0a62-d4c1-411b-9e76-54e84aa90cad', 'accomplishment', 'Launched the Livelihood Improvement for Family Transformation (LIFT) Programme', 'LIFT Programme launched to provide monthly support to eligible families.', 'Social Protection', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('fbef0a62-d4c1-411b-9e76-54e84aa90cad', 'c540b4d6-7a9f-4b5f-8795-4f620ca178f4');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('fbef0a62-d4c1-411b-9e76-54e84aa90cad', 'd9433244-7274-472f-9829-1c377d6addd7');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('541c6923-1896-43da-827b-d53f8e1594b0', 'accomplishment', 'Launched the ASPIRE Programme with 4,300+ participants', 'ASPIRE provides EC$1,000 to each eligible child aged 5-18, split between a savings account and shares in local entities; over 4,300 participants enrolled to date. NOTE: cross-check this figure against the more recent SKNIS Budget Address 2026 figure of 4,270 approved applications before publishing — flagged discrepancy from earlier in this project.', 'Social Protection', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('541c6923-1896-43da-827b-d53f8e1594b0', '58979992-477f-4f73-a29f-34e6cba9745f');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('541c6923-1896-43da-827b-d53f8e1594b0', 'f6d9edfa-7a72-49be-a7de-f0b11410c620');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('e3b9895a-4615-497c-9526-a3fd5718ebe4', 'accomplishment', 'Reinstated the MAGIC mentoring programme in schools', 'Royal St. Christopher & Nevis Police Force''s MAGIC (Mentoring, Advising, Guiding, Instructing Children) Programme reinstated at Joshua Obadiah Primary School.', 'Social Protection', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('e3b9895a-4615-497c-9526-a3fd5718ebe4', '58979992-477f-4f73-a29f-34e6cba9745f');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('e3b9895a-4615-497c-9526-a3fd5718ebe4', 'f6d9edfa-7a72-49be-a7de-f0b11410c620');

INSERT INTO claims (id, stance, title, summary, category, event_date, year, extracted_by, extraction_confidence, review_status)
VALUES ('ba79ef4a-64b8-425d-a3aa-f915dd63122c', 'accomplishment', 'Expanded the Seniors Daycare Programme', 'Seniors Daycare Programme expanded to Lodge, Tabernacle and Sandy Point.', 'Social Protection', NULL, NULL, 'claude_vision_manual', 'medium', 'pending_review');

INSERT INTO claim_sources (claim_id, source_id) VALUES ('ba79ef4a-64b8-425d-a3aa-f915dd63122c', '58979992-477f-4f73-a29f-34e6cba9745f');
INSERT INTO claim_proof_documents (claim_id, proof_id) VALUES ('ba79ef4a-64b8-425d-a3aa-f915dd63122c', 'f6d9edfa-7a72-49be-a7de-f0b11410c620');
