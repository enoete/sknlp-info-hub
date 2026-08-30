-- ============================================================
-- Seed: sources_registry — real, confirmed channels and sites.
-- These were designed and documented across many earlier sessions
-- but only ever existed as commented-out SQL in schema.sql —
-- never actually run against the live database. This file makes
-- them real. Safe to run once; re-running would create duplicates
-- (no unique constraint on label), so confirm this hasn't already
-- run before executing.
-- ============================================================

INSERT INTO sources_registry (label, platform, handle_or_url, source_type, tier, detection_method, poll_frequency_min, requires_manual_capture, status, notes) VALUES
('SKNLP official YouTube', 'youtube', '@StKittsNevisLabourParty', 'official_party', 'owned', 'push_webhook', NULL, false, 'active', 'OAuth connected, official captions API'),
('SKNIS official YouTube', 'youtube', '@SKNISmedia', 'official_govt', 'owned', 'push_webhook', NULL, false, 'active', 'Government information service — NOT opposition, same tier as sknis.gov.kn'),
('SKNIS press releases', 'sknis', 'https://www.sknis.gov.kn', 'official_govt', 'owned', 'public_rss', 15, false, 'active', 'Sitemap/RSS polled every 15 min'),
('SKNLP official website', 'website', 'https://sknlabourparty.com', 'official_party', 'owned', 'public_rss', 30, false, 'active', 'Party''s own site, likely has press releases; confirm feed availability'),
('PAM official YouTube', 'youtube', '@pamsknofficial4503', 'opposition', 'third_party', 'public_rss', 60, false, 'active', 'Public channel, no auth needed; posts infrequently — low volume expected'),
('WINN FM news site', 'website', 'https://www.winnmediaskn.com', 'press', 'third_party', 'public_rss', 60, false, 'active', 'WordPress; has Local News + Press Release categories; confirm /feed/ works'),
('WINN FM YouTube (talk shows)', 'youtube', 'channel/UCENebMHKAAEYEQ-AXNrfbIw', 'press', 'third_party', 'public_rss', 120, false, 'active', 'Hosts ISLAND TEA, VOICES, INSIDE THE NEWS — has featured opposition figures directly'),
('Freedom FM news site', 'website', 'https://freedomfm1065.com/news', 'press', 'third_party', 'public_rss', 60, false, 'active', 'WordPress; existing tag pages for PAM, People''s Action Movement, Natasha Grey-Brookes — taxonomy already aligns well'),
('Freedom FM YouTube', 'youtube', '@FreedomFM106.5', 'press', 'third_party', 'public_rss', 120, false, 'active', 'Confirm channel activity level before relying on it'),
('ZIZ news', 'website', 'https://zizonline.com', 'press', 'third_party', 'manual_capture', NULL, true, 'paused', 'Site currently offline (as of Aug 2026) — do not build automation against this until it''s confirmed back up. Government-aligned outlet when active; never treat as independent confirmation in Opposition Watch comparisons.'),
('SKNIS Facebook page', 'facebook', 'facebook.com/sknismedia', 'official_govt', 'third_party', 'manual_capture', NULL, true, 'active', 'CONFIRMED blocked from automated access — robots.txt explicitly disallows it (verified directly, not assumed). Source of the "4P" campaign graphics and video series (InFocus, Conversations). Meta Page Public Content Access review is a much lower-risk ask here than for opposition monitoring, worth pursuing given how much content lives here — still manual_capture until that access is confirmed set up.'),
('Talk SKN — Kyle Flanders', 'youtube', '@TalkSKN', 'third_party', 'third_party', 'public_rss', 60, false, 'active', 'Independent political commentator, not party-affiliated. Channel itself is third_party; individual claims extracted from it can still carry stance=opposition_statement when warranted. RSS: youtube.com/feeds/videos.xml?channel_id=UCCFwjEhC4u8gzeJAUOpZFSw'),
('Opposition figures — Facebook (manual)', 'facebook', 'n/a — manual only', 'opposition', 'third_party', 'manual_capture', NULL, true, 'active', 'Timothy Harris, Shawn Richards, Mark Brantley, Natasha Grey-Brookes — Meta Graph API review not pursued; comms team uploads clips/screenshots directly');
