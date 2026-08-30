# Project context for Claude Code

You're building **SKNLP Info Hub** — a sourced, citation-mandatory archive of
SKNLP accomplishments, paired with an "Opposition Watch" feature and a
retrieval-only chatbot. This is being demoed in about a week, so prioritize
a working vertical slice over completeness.

## Political volatility — design for change, don't hardcode roles

Political roles here are not stable. As of now: Natasha Grey-Brookes was
PAM's leader for about a year and has just stepped down; PAM has an
internal leadership convention coming up, and general elections may be
called as early as November. Expect the opposition leadership picture to
change, possibly more than once, before this product is even a few months
old.

**Do not hardcode "current role" as a fixed attribute anywhere that
statements get attributed retroactively.** Specifically:
- `speakers.org` should record general affiliation (e.g. "PAM"), not a
  title like "PAM Leader" — titles change, affiliation is more stable.
- The *title/role at the time of the statement* belongs on the `sources`
  or `transcript_segments` row (e.g. a free-text `speaker_title_at_time`
  field, or just captured in the source's `speaker_org` string as scraped),
  not derived live from a "current title" lookup on `speakers`. A statement
  Grey-Brookes made as PAM leader in June should still say "PAM Leader" next
  to it in October even after she's stepped down — that's accurate
  historical attribution, not an error to "fix."
- Whatever the admin UI shows as a person's *current* role can update
  freely without touching historical records. If this isn't already how
  `claim_sources`/`transcript_segments` display resolves titles, add a
  `speaker_title_at_time TEXT` column to `transcript_segments` before
  seeding real data — cheap to add now, painful to retrofit after PAM's
  convention changes leadership again.

## Scope window — enforce this

This administration's term only: **August 5, 2022 (inauguration) through
today.** The prior "Unity" administration (2015-2022) and earlier SKNLP eras
are explicitly out of scope for now — do not backfill without a separate,
explicit decision to expand scope. Implement as an app-level config constant
the ingestion agent checks against (skip/flag anything with `published_at`
before the cutoff), not a rigid database CHECK constraint, since scope is
expected to expand later.

## Speaker identification — context first, voice as reinforcement

Correction to the original design: **context signals (video title, channel
identity, on-screen text, spoken introductions) are the primary
identification signal, not voice matching.** They're cheaper, often more
explicit, and frequently sitting right there in metadata before any deep
analysis happens — e.g. WINN FM titles videos like "Hon. Mark Brantley -
Aug 25 2026" directly. `extract_from_video.py` now fetches video
title/channel via YouTube's oEmbed endpoint and feeds it to Gemini
explicitly, and every segment records which signal actually drove the
identification (`identification_signal` field) — never just a bare
confidence score with no explanation of why.

`identify_speaker.py`'s `resolve_speaker_identity()` is the fusion step:
- Strong context + person not yet enrolled → **auto-assign AND
  auto-enroll their voiceprint from this clip** (bootstraps enrollment
  without requiring the team to manually source clean clips up front),
  flagged for a lightweight non-blocking spot-check, not held back from
  publishing.
- Strong context + already enrolled + voice agrees → highest-confidence
  auto-assign.
- Strong context + already enrolled + **voice matches a DIFFERENT enrolled
  person** → real disagreement, always routes to `needs_confirmation` with
  both pieces of evidence shown. Never auto-resolve a disagreement
  silently — this is exactly the case that catches a misleading title or a
  mistaken on-screen credit.
- No usable context → falls back to voice-only matching as before.

One risk worth being explicit about: auto-enrolling from a single
unconfirmed context signal (the `auto_assign_new_enrollment` case) means a
wrong title or a Gemini misread could seed a voiceprint with the wrong
person's audio, which would then quietly bias future matches. The
non-blocking spot-check flag exists specifically to catch this — don't
remove it for convenience. It should show up somewhere visible (a
"recently auto-enrolled — worth a glance" list in the admin UI) even
though it doesn't block publishing.

## Speaker identification — enrollment with active learning

Decision update: use two separate tools for two separate jobs, not one
tool trying to do both.

- **Content/claims** — `extract_from_video.py`, Gemini. Excellent at
  understanding what's said and drafting claims, but has no memory across
  API calls — every video is analyzed fresh.
- **Speaker identity** — `identify_speaker.py`, pyannoteAI. Purpose-built
  for persistent, improving voice matching via enrolled voiceprints. This
  is the piece that actually "learns" over time, which Gemini alone does
  not do.

(Note: Azure's speaker recognition service — the one most older tutorials
reference — was retired September 2025. Amazon Connect Voice ID retired
May 2026. Don't build against either.)

The loop:
1. Enroll each of the known figures (see list in `extract_from_video.py`)
   from a few clean confirmed clips.
2. On new segments, match against enrolled voiceprints. Route by
   confidence: high → auto-assign, medium → surface in the review queue as
   "confirm this speaker?" with a short clip, low → leave as
   `unknown_speaker`, no suggestion.
3. Every confirmed or corrected medium-confidence match becomes a new
   `speaker_voice_samples` row and gets re-enrolled — this is what makes
   the ask-rate go down over time instead of staying flat. See the
   `SPEAKER IDENTIFICATION` comment block in `schema.sql` for the full
   loop written out.

The admin review queue UI needs a lightweight "confirm this speaker" card
for the medium-confidence case: short audio clip, the model's best guess,
and three actions — confirm / it's someone else (pick or add) / not sure.
This did not exist in the original mockup — add it as a queue-item variant
alongside the claim-review cards already there.

## Containerization — decided, matches existing droplet setup

The rest of the droplet's services run in containers; this app should too,
for consistency and easier management alongside them. `Dockerfile` and
`docker-compose.yml` are in the project root as a starting point.

- **Postgres is containerized too**, not just the app — using
  `pgvector/pgvector:pg16` (maintained by the pgvector project itself),
  which ships the extension pre-built. This avoids the manual "install
  pgvector" step entirely. `schema.sql` is mounted into
  `/docker-entrypoint-initdb.d/` so it runs automatically on first
  container startup — no manual `psql < schema.sql` step needed once this
  is running.
- **Port conflict**: the droplet already has native Postgres bound to
  5432 (confirmed running, cluster "main"). The compose file maps the
  containerized Postgres to host port 5433 to avoid a clash while both
  exist side by side. Before disabling/reclaiming 5432 from the native
  instance, **check whether anything else on the droplet depends on it**
  — don't assume it's safe to stop just because this project doesn't need
  it.
- **Backups are now your responsibility.** A managed DB would have this
  built in; a self-hosted containerized Postgres does not. Set up a
  scheduled `pg_dump` (cron job, or a small backup container) before real
  content accumulates in the review queue — losing curated claims a week
  before launch would be a genuinely bad time to discover there was no
  backup strategy.
- `DB_PASSWORD` needs to be set as an actual environment variable or in
  `.env.local` before `docker compose up` — it's referenced via `${DB_PASSWORD}`
  in the compose file, not hardcoded.

## Ingestion agent — build this now, not post-launch

Decision update: automate video ingestion using `ingestion/extract_from_video.py`
as the starting point. It sends a YouTube URL directly to Gemini (video
understanding API — no download or separate transcription step needed) and
gets back structured segments + candidate claims in one call, using a
strict JSON schema. This replaces the "manual entry only for launch" plan
from earlier — the person who commissioned this is willing to invest in
automation now rather than defer it.

What this changes:
- Ingestion is no longer purely manual for launch. Wire
  `extract_from_video.py` output into the `claims`/`sources`/
  `transcript_segments` tables as `pending_review` rows — same review queue
  as before, but pre-filled by the model instead of typed by hand.
- Speaker identification is attempted automatically (Gemini reads on-screen
  names and context) but is confidence-scored. Anything below `high`
  confidence must render as `unknown_speaker` in the review queue and
  block on manual identification before it can be approved — never
  silently auto-assign a low-confidence speaker match.
- Claim extraction is deliberately conservative (see the prompt in the
  script) — fewer, higher-confidence claims rather than exhaustive
  extraction. Resist the urge to loosen this for volume; false claims are
  far more costly to this product than missed ones.
- Facebook is still NOT solved by this — Gemini analyzing a YouTube URL
  doesn't touch the Meta access problem at all. The Facebook
  manual-capture plan from earlier is unchanged.
- Test this against actual local speech patterns/accents early — general
  benchmarks don't tell you how it performs on Kittitian/Nevisian English
  specifically. Run it against a handful of real videos from each channel
  before trusting it at volume.

The Quick Add tool (`design-reference/quick-add.html`) remains useful as a
fallback for Facebook content and for anything the agent gets wrong or
skips — don't delete it.

**Schema sync is a required step, not an afterthought.** Whenever a new
column is added to `claims`, explicitly check whether
`extract_from_video.py`'s `RESPONSE_SCHEMA` needs the same field — don't
assume the ingestion script will get updated "eventually" just because
the DB and UI did. This already happened once: `citizen_impact` was added
to `schema.sql` and rendered on the Dashboard, but nobody went back and
added it to `RESPONSE_SCHEMA`, so the extraction agent had no way to ever
populate it — caught only when the field was later spot-checked directly
against a real extraction run. Treat this with the same discipline as the
political-role forward-reference checks elsewhere in this doc (see
"Political volatility" above): a new writable `claims` column is not done
until `extract_from_video.py` has been checked against it, even if the
honest answer is "this field doesn't apply to model extraction, skip it
on purpose" — silence/omission is the failure mode to avoid, not any
particular answer.

Cheap automated backstop for the above: `tests/test_extraction_schema_sync.py`
diffs `claims`' writable columns (parsed from `schema.sql`) against
`RESPONSE_SCHEMA`'s declared fields and fails on any column that's neither
extracted nor explicitly excluded with a reason. Run it after any `claims`
schema change: `python3 tests/test_extraction_schema_sync.py`. It's already
caught one real gap (`event_date` had no extraction coverage and no
documented reason) — see below for how that was resolved.

**Draft fields need a review-queue confirmation affordance — don't let the
ingestion agent write straight to a human-authorship-only column.**
`citizen_impact` and `event_date` are both human-confirmed-only columns
(see their comments in `schema.sql`); the ingestion agent only ever
proposes into a parallel `*_suggested` column
(`citizen_impact_suggested`, `event_date_suggested`) and never writes the
real column directly. That split is only meaningful if the review queue
actually surfaces the suggestion for a human to act on — right now
neither does. The admin review queue UI needs a lightweight "confirm
suggested date" affordance alongside the claim review card — same pattern
as the "confirm this speaker" card already speced above (see "Speaker
identification — enrollment with active learning"): show
`event_date_suggested`, and three actions — confirm / edit / reject —
only writing to `claims.event_date` once a human acts. `citizen_impact_suggested`
needs the identical treatment (it has the Dashboard-rendering half done
already, but no promotion affordance yet). Add both as queue-item
elements alongside the claim-review and confirm-speaker cards. Not built
yet — documented here so it isn't lost, same as the citizen_impact
rendering gap was before it got built.

## Known sources for `sources_registry` seed data

- `@StKittsNevisLabourParty` (YouTube) — `source_type = 'official_party'`, `tier = 'owned'`
- `@SKNISmedia` (YouTube) — `source_type = 'official_govt'`, `tier = 'owned'`.
  **This is the government's own information service, not an opposition
  source** — do not tag this as opposition, it's the same tier as
  sknis.gov.kn.
- `@pamsknofficial4503` (YouTube, PAM / People's Action Movement) —
  `source_type = 'opposition'`, `tier = 'third_party'`, `detection_method =
  'public_rss'`. Note: opposition YouTube channels post infrequently — don't
  expect this to be a high-volume source. Facebook is where opposition
  activity concentrates, and Facebook is `requires_manual_capture = true`
  for now (see below).
- Named opposition/political figures to track as `speakers` rows (role
  title + org, not personal profiling): Timothy Harris, Shawn Richards,
  Mark Brantley, Natasha Grey-Brookes. Their statements should be sourced
  from (a) their party's official channels where available, (b) local news
  coverage (see below), and (c) manually-fed content — never from scraping
  personal social profiles.

## Third source tier: local news coverage (confirmed)

Three outlets confirmed and characterized:

- **WINN FM** (winnmediaskn.com) — WordPress, has Local News + Press
  Release category pages. Also hosts their talk shows (ISLAND TEA, VOICES,
  INSIDE THE NEWS) on YouTube at `channel/UCENebMHKAAEYEQ-AXNrfbIw` —
  register this as a separate `sources_registry` row from the website, it's
  an independent detection path. Has directly featured opposition figures
  (a "Hon. Mark Brantley" episode was observed).
- **Freedom FM** (freedomfm1065.com/news) — WordPress, has a well-developed
  tag taxonomy that already includes "PAM," "People's Action Movement," and
  "Natasha Grey-Brookes" as existing tags — this maps closely to the
  `speakers` table and is worth using as a categorization hint during
  extraction. Also directly quotes Harris, Brantley, and Daniel-Hodge (NRP)
  from press conferences. Also has a YouTube channel, `@FreedomFM106.5`.
- **ZIZ** (zizonline.com) — government-aligned outlet (per the person who
  commissioned this project: "always a mouthpiece for the current
  government"). The homepage did not resolve to a clear news-article path
  during initial research — locate the actual news section URL structure
  before registering this as an automated source. When it is added, tag it
  `source_type = 'press'` with a registry note flagging it as
  government-aligned, and never use it as the sole "closest documented
  record" in an Opposition Watch comparison — its independence is
  questionable by the client's own account, so treat it more like a second
  official-adjacent source than independent press.

`source_type = 'press'` for all three, `tier = 'third_party'`. Confirm RSS
feed availability at each (`/feed/` is the WordPress default path, likely
present but not yet verified) before deciding on `public_rss` vs. scraping.

## Fourth source category: independent political commentary (confirmed)

Distinct from the press outlets above — not a news organization, one
person's own political commentary — so it gets its own category rather
than being folded into "local news coverage."

- **Talk SKN — Kyle Flanders** (YouTube, `@TalkSKN`, channel ID
  `UCCFwjEhC4u8gzeJAUOpZFSw`) — verified via a live fetch of the channel's
  own "About" text: *"On this channel I will give you my views on the
  political landscape and news on the island of St Kitts and Nevis."*
  Independent commentator, not affiliated with any party — that's why the
  channel is registered as `source_type = 'third_party'` rather than
  `'opposition'` at the `sources_registry` level, even though individual
  claims extracted from it can still carry `stance = 'opposition_statement'`
  when warranted (stance is judged per-claim by the ingestion agent, not
  inherited wholesale from the source's registry classification — the same
  principle that keeps SKNIS from being tagged opposition just because a
  claim quotes criticism). `tier = 'third_party'`, `detection_method =
  'public_rss'` (RSS: `youtube.com/feeds/videos.xml?channel_id=UCCFwjEhC4u8gzeJAUOpZFSw`).

## Copyright / display rule for news sources

Store only short extracts/summaries plus a link back to the original
article — never reproduce full article text, even internally-displayed.
This is both a legal-exposure issue (these are copyrighted news articles)
and consistent with how citations work everywhere else in this product:
link to the source, don't republish it.

## Facebook — explicitly out of scope for automation this phase

Do not build automated Facebook scraping. Meta's Graph API requires app
review for Page Public Content Access, and that review specifically
scrutinizes political-monitoring use cases — approval is not guaranteed and
timelines don't fit a one-week demo. For now, Facebook content (including
from the named figures above) comes in exclusively through the existing
admin-upload path in `proof_documents` / manual `sources` entries — a person
finds and uploads the post/clip, same review queue as everything else. Keep
this constraint intact even after the demo unless someone has actually
pursued and secured Meta app review — don't quietly build scraping around it.

## Non-negotiable rules (do not relax these for speed)

- **Every public claim must trace to a row in `sources` or `proof_documents`.**
  If there's no source, the UI shows "no official record found" — never a
  synthesized or inferred answer.
- **The chatbot never answers from general knowledge.** It only retrieves
  from the approved `claims` table and cites what it finds. See
  `chatbot_system_prompt.md` for the exact rules — follow them literally.
- **Nothing reaches the public views without `review_status = 'approved'`.**
  Pending/rejected claims are invisible outside the internal admin queue.
- **Opposition statements are shown, never characterized as false.** Claim
  next to record, both cited, no verdict language in copy or in generated
  chatbot responses.

## Design reference

`design-reference/mockup.html` is the actual pixel spec — open it in a
browser. Brand: SKNLP red (#C8102E) as primary accent, gold (#F4B400) for
citations/highlights, near-black ink on off-white/white paper (light mode).
Anton for display headlines, Barlow Semi Condensed for nav/labels, Inter for
body, IBM Plex Mono for dates/timestamps. A soft blurred red/gold bezier
wash sits behind hero sections — see `app/layout.tsx` for the working
implementation, reuse that pattern rather than reinventing it per-page.

Six views: Dashboard, Claim detail, Ask the Record (chatbot), Opposition
Watch, Speakers, Calendar, plus an internal Review Queue. Nav exists in two
places in the mockup (sidebar + top tab strip) — keep both, they were added
deliberately after user testing showed single-nav was easy to miss.

`design-reference/source-manager-mockup.html` is the pixel spec for the
Source Manager (internal, admin-only) and the public "Suggest a Priority"
feature bundled in the same mockup file. Covers: registered-sources list
with run/edit/delete actions, an "add a source" form supporting multi-modal
single-post attachments (image+text+video grouped under one source — see
`source_attachments` in `schema.sql`), per-run extraction results, plus the
separate anonymous public suggestion box and its admin-facing trending-themes
view. Being built in stages, not all at once — see "Ingestion agent" above
for the schema this depends on (`sources_registry.deleted_at`,
`source_attachments`, `document_chunks`).

## Data model

`schema.sql` is the full Postgres schema. Key tables: `claims` (the atomic
unit, either `stance = 'accomplishment'` or `'opposition_statement'`),
`sources` (every scraped/submitted origin, links back to `sources_registry`
which is config for the ingestion agent — not built yet, out of scope for
demo), `transcript_segments` (powers timestamped YouTube deep links via
`start_seconds`), `speakers` (voice-identified individuals), `proof_documents`
(party-uploaded evidence, keeps `document_dated_at` separate from
`uploaded_at` — never conflate these), `audit_log` (every admin action,
append-only).

For the demo, seed the database directly from the real 113-item
accomplishment list rather than building the ingestion agent — that's a
phase-2 concern. Manual seed data closely matching real SKNLP announcements
is fine and expected for a proof of concept.

## What can be mocked/stubbed for the demo, what can't

- **Can stub**: the ingestion agent (YouTube/sknis scraping), voice
  diarization, the admin review queue's actual approve/reject logic (can be
  visual-only, matching the mockup)
- **Cannot stub**: the citation requirement anywhere in the public-facing UI
  or chatbot — this is the entire credibility premise of the product, and
  faking it would undermine the whole pitch if anyone clicks a source link
  during the demo and it goes nowhere. If a citation can't be a real, working
  link during the demo, don't show that claim at all — better to have fewer,
  fully real claims than many with broken/fake sources.

## Deployment target

DigitalOcean droplet at `104.236.15.123`, domain `sknlphub.tekii.org`. See
`README.md` for the full nginx + pm2 + certbot deployment steps already
written out.
