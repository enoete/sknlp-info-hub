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

## Call-in callers — captured and quoted, never named or enrolled

Decision (2026-08-31), prompted by adding Straight Talk (see "Fourth
source category" below): Straight Talk and shows like it take live phone
calls from members of the public, and those callers matter — per the
person who commissioned this project, "they deserve to be heard" — so
their statements should be extracted into `candidate_claims` exactly like
a named figure's, not skipped just because there's no name attached.

**But explicitly no need to capture names**, and — more important than
the UI label — a caller must never enter the voiceprint
enrollment/matching loop described above. Concretely:
- `extract_from_video.py`'s prompt and `RESPONSE_SCHEMA` now instruct
  Gemini to label any phone-in caller with the literal generic
  `speaker_label`/`role_as_stated` of `'Caller'` and
  `identification_signal = 'caller_phoned_in'` — a new, distinct enum
  value, not `'none'`/`'voice_only_no_context'`, since this is a
  deliberate non-identification, not a failed one. `speaker_confidence`
  should still be `'high'` for a caller — the call-in format itself is
  the confirming signal.
- That `role_as_stated` flows straight through into
  `transcript_segments.speaker_title_at_time` via the existing
  `compute_segment_window()` mechanism (`ingestion/segment_utils.py`) —
  no separate code path needed, it's the same historical-attribution
  field already used for political titles (see "Political volatility"
  above), just holding `'Caller'` instead of a name/title.
- `identify_speaker.py`'s `resolve_speaker_identity()` early-exits on
  `context_signal == CALLER_SIGNAL` and returns a `'caller'` decision
  with no enrollment and no voice-matching attempt at all. This matters
  even though the voice pipeline isn't wired to live ingestion yet:
  without this guard, the fusion logic would treat the shared generic
  label `'Caller'` as "a person not yet enrolled," bootstrap a voiceprint
  from the first caller's clip, and then silently start matching every
  future unrelated caller against that one recording — a real identity
  mix-up, not just a cosmetic labeling gap.

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
  **Update 2026-08-31**: ZIZ's YouTube channel — `@ZIZRadioTV`
  (channel ID `UCMM3pFsfN2CYHpUa-xMbKQg`, confirmed live) — registered
  in `sources_registry` (id `30d13b22-b154-48b8-a581-0e18f9011d1f`),
  same `source_type = 'press'`/government-aligned caution as the
  website. High-value and high-volume: confirmed via its public RSS
  feed and a live web search that this channel posts daily (news,
  talk shows) and carries real recordings of full National Assembly
  sittings going back to at least 2023 — genuinely primary-source
  Parliament content, not just ZIZ's own editorial framing, so the
  government-aligned caution applies more to their news/talk content
  than to a raw sitting recording. **Registering the source does not
  ingest anything by itself** — see "Ingestion agent" above: there is
  no automated channel crawler built yet (no code reads any
  `detection_method`/RSS field automatically), only the one-video-at-
  a-time `run_ingestion.py --registry-id <id>` path, which still
  requires a human to already have the specific video URL. Someone
  needs to either paste individual National Assembly sitting URLs in
  for manual runs, or a real channel-level auto-discovery mechanism
  (RSS polling) needs to get built — that's a deliberate scope
  decision, not assumed as already covered.

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
- **Straight Talk — Ian "Patches" Liburd** (YouTube, `@straighttalk3364`,
  channel ID `UCk9m4AfgR5NgC75a0FLhbSA`) — registered 2026-08-31
  (`sources_registry` id `82dd605e-63d4-4355-96e8-dd9fdd74c0da`), same
  posture as Talk SKN above: verified via a live fetch of the channel's
  own "About" text — *"we promote and facilitate free expression on all
  issues of National Interests. Be they Legal, Environmental,
  Technological, Social, Economic or Political"* — independent
  commentator, not party-affiliated, so `source_type = 'third_party'`
  at the registry level even though individual extracted claims can
  still carry `stance = 'opposition_statement'`. Confirmed active via
  RSS (posting as recently as Aug 27 2026); titles run sharply
  critical of government ("A People Stripped of Their Livelihood and
  Dignity"), per the client's characterization a "hard hitter" with
  documented specifics, not just commentary. `tier = 'third_party'`,
  `detection_method = 'public_rss'` (RSS:
  `youtube.com/feeds/videos.xml?channel_id=UCk9m4AfgR5NgC75a0FLhbSA`).
  **Registered only — not yet ingested.** Per the sequencing decision
  below ("Opposition side — sequencing"), no video from this channel
  should be run through `run_ingestion.py`/`run_batch.py` until the
  government-side historical backlog is substantially done.

## Opposition side — sequencing (decided 2026-08-31, revised same day)

Original decision: opposition build-out comes strictly **after** the
government-side historical record is substantially complete, not in
parallel — rationale was that the ZIZ high-value backlog
(`/tmp/ziz_high_value.json` — 51 National Assembly sittings, 8
PM/Minister statements, 53 press conferences) represents far more total
volume and finishing one side deeply avoids two half-built records.

**Revised same day, per explicit instruction from the person who
commissioned this project**: run both concurrently. Government-side
batch ingestion (`run_batch.py`) keeps running unattended as a detached
process (see "Detached long-running ingestion processes" below) while
opposition-side discovery starts now, not after. Framed explicitly as
"a slow and steady race" — expect low volume for a while (the corpus
the cross-reference function has to work with is still thin), not a
rush to fill Opposition Watch immediately. Priority order given:
**Kyle Flanders (Talk SKN) and Straight Talk first**, PLP's official
channel third.

`sources_registry` rows for opposition/third-party sources (Talk SKN,
Straight Talk, PLP) are all registered — see below for PLP, the third
one added at this revision. Incremental discovery
(`run_channel_discovery.py --registry-id <id> --max-new N`) is how new
videos actually get pulled in per channel, same mechanism already used
for `@ZIZRadioTV`; a registry row alone still ingests nothing on its
own (see "Ingestion agent" above).

**"Cross-references and checks for truth/clarification" — already
built, not a new feature.** `app/lib/oppositionWatch.ts`'s
`findClosestRecord()` already does exactly this: for a given opposition
claim, it full-text-searches all approved same-category accomplishment
claims (same OR-of-stemmed-lexemes tsquery approach as `retrieve.ts`,
picked after `plainto_tsquery`'s implicit AND was tested and diluted a
real single-keyword match to near-zero rank) and surfaces the single
closest-ranked one, computed live at page-render time — never stored,
so it can never go stale as more approved claims get added. Rendered on
`/opposition-watch` as "Closest documented record" next to the
opposition statement, or "No official record found... This isn't a
denial" when nothing matches — deliberately neutral language, no
verdict, consistent with the chatbot's rule 3. With opposition-side
ingestion only just starting and the government-side corpus still
filling in, expect mostly "No official record found" for now — that's
the honest state of the data, not a bug in the matching. Revisit
`LIMIT 1` → multiple clarifying records (the code comment already flags
this: "No repeat-clustering yet... that's for when ingestion produces
real volume") once there's enough approved government-side content that
more than one record plausibly addresses the same opposition claim.

- **PLP (People's Labour Party) — official YouTube** (`@plpsoskn`,
  channel id `UCere5DArMJ9FWykLbCKt61A`) — registered 2026-08-31
  (`sources_registry` id `36177b51-7b8f-4468-b974-3aa17ac27601`).
  Distinct party from PAM — Timothy Harris's breakaway party (split from
  SKNLP in 2013), led the Team Unity coalition government 2015-2022,
  reduced to a single seat and opposition status after the 2022
  election. Verified via YouTube Data API (not the RSS-only spot-check
  used for the two commentary channels, since "PLP" alone was ambiguous
  enough — several low-activity channels share the name — that
  subscriber/video-count comparison was needed to confirm the real one:
  2,570 subs, 208 videos, active as of Aug 25 2026, vs. two near-empty
  lookalikes with 2-4 videos each). `source_type = 'opposition'` (same
  as PAM's registry row — an official party channel, not independent
  commentary), `tier = 'third_party'`, `detection_method = 'public_rss'`.

## Detached long-running ingestion processes — survive session disconnects

`run_batch.py`/`run_channel_discovery.py` calls that are expected to run
for hours (the ZIZ historical backlog, ongoing opposition discovery)
must be launched detached from the Claude Code session, not via the
session's own background-task tracking. Confirmed the hard way
2026-08-31: a batch launched through the session's background-job
mechanism was killed outright, twice, the moment the session's own
connection dropped — unrelated to whether the user's connection to
Claude Code stayed up, purely an artifact of the harness tearing down
its tracked child processes with the session. Fix: launch with
`setsid nohup <cmd> > logfile 2>&1 < /dev/null & disown`, which gives
the process its own session id with PPID `1` (reparented to init) —
verified via `ps -o pid,ppid,pgid,sid` that it's fully independent of
the Claude Code session tree. Only a droplet reboot/power-loss stops
it after that. Since it's no longer tracked by the harness, there's no
automatic completion notification — check progress on demand via the
process's log file and a direct DB query (count of `sources` rows per
`registry_id`), not by waiting for a task notification.

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

## Schema status: designed vs. migrated — read this before assuming anything is live

A decision documented in this file, or a table/column written into
`schema.sql`, is **not evidence it exists in the live database.** This
has now happened four separate times: the batch-1 seed data, the un-run
`sources_registry` seed, the un-migrated Source Manager schema
(`sources_registry.deleted_at`, `source_attachments`, `document_chunks`),
and `chat_queries` (fully designed and referenced in this file, never
written into `schema.sql` at all, never migrated — only caught when the
"Dynamic starting suggestions" feature tried to query a table that
didn't exist). Four times is a pattern, not bad luck.

**Rule going forward:** any new table, column, or schema change gets an
explicit status marker below the moment it's decided, not after it's
built, not from memory. Two valid states only:

- 📝 **Designed** — written into `schema.sql` and/or documented here, but
  not yet confirmed against the live DB.
- ✅ **Migrated** — confirmed live via an actual query (`\d <table>` or
  `information_schema.columns`), with the date checked. Running the
  migration isn't enough to earn ✅ — the row flips only after
  independent verification, same bar as every other DB change in this
  project. A memory of "I think I ran that" is not a ✅.

| Table / column | Status | Verified |
|---|---|---|
| `sources_registry.deleted_at` | ✅ Migrated | 2026-08-30 |
| `source_attachments` (table) | ✅ Migrated | 2026-08-30 |
| `document_chunks` (table) | ✅ Migrated | 2026-08-30 |
| `claims.citizen_impact_suggested` | ✅ Migrated | 2026-08-30 |
| `claims.event_date_suggested` | ✅ Migrated | 2026-08-30 |
| `chat_queries` (table) | ✅ Migrated | 2026-08-31 |
| `pg_trgm` extension | ✅ Migrated | 2026-08-31 |
| `claims.year` — **removed** (was drifting out of sync with `event_date`; Dashboard now derives year via `EXTRACT(YEAR FROM event_date)` at query time in `getDashboardClaims`/`getDashboardStats`, single source of truth) | ✅ Migrated | 2026-08-31 |
| `idx_claims_event_date_category` (replaces `idx_claims_year_category`) | ✅ Migrated | 2026-08-31 |
| `claims.accomplishment_type` (sub-classification within `stance='accomplishment'` — see "Accomplishment sub-typing" below) | ✅ Migrated | 2026-08-31 |
| `claims.completes_claim_id` (self-ref, links a later claim to the earlier initiative/decision it completes — see "Initiative follow-through tracking" below) | ✅ Migrated | 2026-08-31 |

One-time full audit completed 2026-08-31, prompted by the `chat_queries`
gap: every table and column in `schema.sql` cross-checked
programmatically (not read through by eye) against
`information_schema.columns` on the live DB, plus every schema-adjacent
decision named in this file's prose (`transcript_segments.speaker_title_at_time`,
the `speaker_voice_samples`/`sample_origin` loop) confirmed present live.
Zero drift found beyond the rows already listed above. Re-run the same
comparison — not a manual read-through — the next time this needs
checking:

```sql
-- live side
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema='public' ORDER BY table_name, ordinal_position;
-- compare against schema.sql's CREATE TABLE ... ( ... ); blocks, same as
-- tests/test_extraction_schema_sync.py already does for claims specifically.
```

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

## Accomplishment sub-typing (`claims.accomplishment_type`)

Decision (2026-08-31): `stance = 'accomplishment'` had been doing double
duty as both "whose side is this claim on" and "what kind of win is
this" — every government-side claim rendered as an identical
"ACCOMPLISHMENT" badge whether it was a finished project, a policy
decision, a strategic commitment, or something merely in progress.
`claims.accomplishment_type` is the honest subtype, one of
**Accomplishment / Policy Decision / Strategic Decision / Ongoing
Initiative** (see the enum's definitions in
`ingestion/extract_from_video.py`'s `RESPONSE_SCHEMA.accomplishment_type`
description, and `app/lib/accomplishmentType.ts` for the shared frontend
constant). `stance` itself is untouched — it still means only
"government/party side vs opposition side," so no existing stance-based
filtering logic changed.

- Written directly by the ingestion agent (same tier as `category`), not
  gated behind a `*_suggested` human-confirmation column — it's a bounded
  classification call, not a freeform narrative judgment.
- **Editable after the fact.** The taxonomy is a judgment call and will
  sometimes be wrong; the Review Queue (`app/review-queue/ReviewQueueClient.tsx`)
  has a live dropdown on every accomplishment-stance claim, in any
  review_status (pending or already-approved/live) — no need to
  unapprove-and-re-review just to fix a label. Backed by
  `PATCH /api/claims/[id]/accomplishment-type` → `updateAccomplishmentType()`
  in `app/lib/reviewQueue.ts`.
- The ~97 claims approved before this field existed were retroactively
  classified via a one-time Gemini pass
  (`ingestion/backfill_accomplishment_type.py`, title+summary only, no
  video) — rerun it (it's idempotent, only touches
  `accomplishment_type IS NULL` rows) if a large batch of old claims ever
  needs reclassifying again; don't hand-classify at volume.
- Rendered on the Dashboard (`app/DashboardClient.tsx`), Timeline
  (`app/timeline/TimelineClient.tsx`), Claim Detail
  (`app/claim/[id]/page.tsx`), and fed into the Ask the Record context
  block (`app/api/ask/route.ts`) with an explicit system-prompt rule
  (`app/api/ask/system-prompt.ts` rule 5a / `chatbot_system_prompt.md`)
  not to describe an 'Ongoing Initiative' or a 'Policy'/'Strategic
  Decision' as completed/delivered — only 'Accomplishment' gets that
  language.

## Initiative follow-through tracking (`claims.completes_claim_id`)

Decision (2026-08-31): an 'Ongoing Initiative' / 'Strategic Decision' /
'Policy Decision' claim (see above) can look perpetually unfinished if
nothing ever connects it to the later claim reporting its completion.
`claims.completes_claim_id` is a nullable self-reference on the **newer**
claim, pointing back at the **earlier** one it fulfills (e.g. a later
"desalination plant completed" claim's `completes_claim_id` points at the
earlier "groundbreaking held" claim).

- **Manual linking only, admin-driven** — same "flag for a human, never
  auto-resolve" posture used elsewhere in this project (see the
  speaker-identity disagreement rule above). No similarity/embedding
  matching attempts to auto-link claims; an admin searches for and picks
  the earlier claim via the Review Queue's "link as completing an earlier
  claim" control, backed by `GET /api/claims/search` (title search over
  approved accomplishment claims,
  `searchAccomplishmentClaims()` in `app/lib/reviewQueue.ts`) and
  `PATCH /api/claims/[id]/completes` (`updateCompletesClaim()`).
- **Reflected in both directions** on the Claim Detail page
  (`app/claim/[id]/page.tsx`'s "Progress" block): the older claim shows
  "Since completed — see [link]", the newer claim shows "Completes —
  see [link]".
- **Dashboard**: an older claim's card shows a green "Since completed"
  banner linking to the newer one the moment an admin links them — see
  `getDashboardClaims()`'s `completed_by_*` fields in `app/lib/claims.ts`
  and `.completedBanner` in `app/DashboardClient.tsx`.
- **Ask the Record**: `app/lib/retrieve.ts` joins both directions
  (`completes_title`/`completed_by_title`) into every retrieved claim, and
  `app/api/ask/route.ts` appends a `STATUS UPDATE: this was later
  completed...` line to the context block when present. System-prompt
  rule 5b instructs the model to report the up-to-date status rather than
  only the stale original claim — verified live: a deliberately
  mismatched test link (an unrelated 2005 claim linked as if it completed
  a 2024 desalination-plant claim) was correctly recognized by the model
  as irrelevant and NOT reported as confirmation of completion, rather
  than blindly trusting the link. That's the safety property this feature
  depends on — never remove or weaken rule 5b's "never claim something
  was completed unless a linked claim actually says so" instruction.

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
