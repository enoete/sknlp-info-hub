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

## Named opposition speaker filtering (decided 2026-08-31)

Prompted directly: "the actual literal person who said it... Timothy
Harris, or Patches or Kyle, we need to be that granular." `speaker_org`
(the channel — Straight Talk, Talk SKN, PLP, ZIZOnline) is the only
speaker field that was reliably populated, and it's too coarse — a
single Straight Talk episode features Ian Liburd's own commentary, a
played clip of a government minister, and sometimes an anonymous caller,
all under one `speaker_org` value.

- `transcript_segments.speaker_name_at_time TEXT` — the actual named
  individual, captured per claim (not per video). Parallel to the
  existing `speaker_title_at_time` (which holds the *role*, e.g. "Member
  for Nevis 9"): same historical-attribution posture, same table, same
  "captured at ingestion time, never derived live" safety property.
- `segment_utils.py`'s `compute_segment_window()` now also borrows the
  enclosing raw segment's `speaker_label` (Gemini already resolves this
  during extraction — see the "Speaker identification" sections above)
  into `speaker_name_at_time`, filtered through a new `_is_real_name()`
  check that excludes generic `"Speaker N"` placeholders and the literal
  `"Caller"` label — a caller is never named, by design (see "Call-in
  callers" above), and a genuinely-unidentified speaker should stay
  `NULL`, not get a fake placeholder value that would corrupt name-based
  filtering by grouping unrelated unidentified people together.
- **Backfill for the ~318 claims ingested before this column existed**:
  `ingestion/backfill_speaker_name.py`, same batched-Gemini-classification
  pattern as `backfill_accomplishment_type.py` — passes each claim's
  title/summary/role/source context plus the full `KNOWN_FIGURES` list
  and the two channel-host mappings (Kyle Flanders = Talk SKN, Ian
  "Patches" Liburd = Straight Talk), asks for the actual named speaker or
  the literal sentinel `"UNKNOWN"` (never a guess). Skips any segment
  already marked `speaker_title_at_time = 'Caller'` outright. Run
  2026-08-31: **292 of 318 resolved** to a real name (the rest correctly
  left `NULL`) — spot-checked against every figure named elsewhere in
  this file, no misattributions found. Also surfaced several real
  figures not previously tracked anywhere in this project (Delonte
  Lewis, Troy Hendrickson, Valma Caesar, Police Commissioner James
  Sutton, Cromwell Henry) — worth adding to `KNOWN_FIGURES` if they keep
  recurring.
- `app/lib/oppositionWatch.ts`'s `OppositionPair.named_speaker` surfaces
  this (via a subquery on `claim_transcript_segments`/`transcript_segments`,
  same pattern as the existing `source_start_seconds` deep-link lookup).
  `OppositionWatchClient.tsx`'s speaker filter uses
  `named_speaker ?? speaker_org` — falls back to the channel only for
  the claims that genuinely have no resolved individual yet, so nothing
  silently disappears from the filter list mid-backfill.
- Known gap, not hidden: this only covers opposition-side sources so
  far (where the request was scoped). Government-side ZIZ claims still
  only have `speaker_title_at_time` (e.g. "Prime Minister & Minister of
  Finance") without necessarily a resolved name on older rows — same
  backfill script would cover this if extended to `stance='accomplishment'`
  claims too, not done yet since it wasn't asked for.

**Update 2026-08-31, same day**: the initial backfill run itself produced
name-variant fragmentation — "Ian Liburd" and `Ian "Patches" Liburd`
(also "Dr. Geoffrey Hanley" / "Dr. Geoffrey Ian Hanley", "Dr. Timothy
Harris" / "Timothy Harris") landed as separate `speaker_name_at_time`
values for the same real people, which would silently split the
per-speaker filter for anyone affected. Normalized the existing rows
directly, then fixed the root cause in both places a name gets assigned:
`extract_from_video.py`'s `speaker_label` field description now
explicitly requires the exact string from `KNOWN_FIGURES` (name portion
only, before the em-dash — not the affiliation suffix) rather than
whatever form the source text happens to use, and
`backfill_speaker_name.py` got the identical instruction. `CHANNEL_HOSTS`
also moved from being duplicated in the backfill script into
`extract_from_video.py` as the single source of truth, and is now wired
into the live extraction prompt too (previously only the backfill script
had host-name context — a live-ingested Straight Talk claim could have
produced yet another name variant with no correction path at all).

## Record-pairing relevance floor (decided 2026-08-31)

Real bug, caught by the client reviewing live data: "the one with
Terrence Crossman being terminated does not have a contextual
clarification... audit this and make sure it makes sense, and if there
isn't any clarification, then just leave it at that till there is one."
`oppositionWatch.ts`'s `findClosestRecord()` — used both by the public
`/opposition-watch` page and by `retrieve.ts`'s chatbot cross-reference
(see "Opposition side — sequencing" above) — always returned the
top-ranked same-category claim with no floor on how weak that match
actually was. Verified live: "Termination of...Terrence Crossman"
(category Governance) was paired with "Unaccounted Cash at Development
Bank" — a *different bank entirely*, connected only by generic shared
words ("bank", "national") — at `ts_rank` 0.103. A genuine match (the
"2,400 NHC housing units" pairing) scored 0.13-0.16 for comparison.

**First fix (superseded same day): `MIN_RELEVANT_RANK = 0.12` threshold
alone.** Not enough — a second bad pairing surfaced immediately after
deploying it: "Crossman's compensation contract" paired with unrelated
National Bank *asset-size* stats at rank 0.200, HIGHER than the genuine
housing-units match, purely because both texts share the bank's full
institutional name verbatim. `ts_rank` rewards exact phrase overlap
regardless of whether two claims are about the same specific matter, so
no single number can reliably separate "real match" from "same
institution, different story" — proven by these two data points
bracketing each other (bad=0.200 > good=0.158).

**Actual fix: real relevance judgment, not a bigger number.**
`findClosestRecord()` now uses `ts_rank` only as a cheap pre-filter
(`MIN_RELEVANT_RANK` dropped to 0.05, just to skip zero-signal noise)
and gates the final answer on `isGenuinelyRelevant()` — one Haiku call
asking directly whether the candidate record addresses the same specific
matter as the claim, not just the same institution/category. Fails
closed on any error, missing key, or non-2xx response (no record shown),
same "show nothing over a bad pairing" posture as before. Since this
adds a real LLM call per opposition claim, `getOppositionPairs()` now
caches its result for 10 minutes (previously explicitly uncached,
"always live" per its own old comment) and runs the per-claim lookups in
parallel rather than sequentially — a cold page load went from 47.6s to
3.1s with today's ~60 opposition claims, verified live before and after
both changes. `retrieve.ts`'s related-record lookup still shares the
same lowered `MIN_RELEVANT_RANK` pre-filter but does NOT get its own
`isGenuinelyRelevant()` call — verified live instead that the chatbot's
own downstream model call already filters irrelevant "related" rows
correctly on its own judgment (per rule 3's explicit instructions), so a
second LLM call in that hot path wasn't worth the added chat latency.

Same audit also found 6 confirmed same-video extraction duplicates (the
Crossman claim itself was one of them — two near-identical extractions
of the same fact from the same video) via a `pg_trgm` title-similarity
sweep, rejected. Scoped to the clearest, highest-confidence candidates
only — not an exhaustive pass across every `similarity() > 0.4` hit,
several of which turned out to be legitimate distinct claims (the same
real-world fact independently reported across two different videos/
sources, which is corroboration, not duplication) rather than bugs.

**Terminology**: the client also flagged the UI label itself —
"Closest documented record" implied a literal document; renamed to
"Clarification" (and the parallel status pills to "Clarified" / "No
clarification yet") across `/opposition-watch`, the claim detail page,
and the chatbot's own internal language about the same concept, so the
framing is consistent everywhere it appears — see
`OppositionWatchClient.tsx`, `app/claim/[id]/page.tsx`,
`chatbot_system_prompt.md`/`system-prompt.ts`.

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

**Update 2026-08-31**: the same cross-reference now also runs inside
the chatbot, not just the static `/opposition-watch` page — per explicit
instruction ("if there is a clarification that the government has
provided, it should be included as a part of the answer... makes it
fair"). `app/lib/retrieve.ts`'s `retrieve()` checks, for every retrieved
opposition claim without a same-category accomplishment claim already
in its top-3 lexeme hits, whether `findClosestRecord`'s same category-
based matching turns one up, and appends it as a `match_type: 'related'`
row. This matters because most real opposition-vs-record pairs don't
share enough vocabulary for the tsquery match alone to find them (e.g.
"water shortages in Cayon" vs. "well-drilling initiative with BEAD" —
verified live, the chatbot correctly pulled in the drilling project as
context while still respecting rule 5a: called it "ongoing," not a
completed fix). The context block flags a related row explicitly so the
model never treats a same-category pairing as confirmation — same
"closest documented record, not a verdict" posture as the page itself,
now reinforced in both `chatbot_system_prompt.md` and
`system-prompt.ts`.

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

## Opposition historical backfill (built 2026-08-31)

Prompted directly: "the opposition claims... is very skant... beef that
up with real facts and records." Real gap confirmed before building
anything: every opposition-side channel (Talk SKN, Straight Talk, PLP,
and PAM — never even checked once, `last_checked_at` was null) had only
ever been discovered via `run_channel_discovery.py`'s RSS path, which
YouTube caps at the ~15 most recent uploads — there was no equivalent of
ZIZ's own historical backfill on the opposition side at all.

- `ingestion/run_channel_historical_backfill.py` — new script,
  generalizes the one-off approach used for ZIZ's backlog into a
  reusable tool: walks a channel's full upload history back to the Aug 5
  2022 scope cutoff via `discover_channel.find_historical_candidates()`,
  then runs up to `--limit` of the discovered candidates through the
  existing `ingest_one_video()` write path (same `pending_review`-only
  safety guarantee as everything else). `--max-pages` bounds how deep
  the discovery walk goes independent of how many actually get sent to
  Gemini this run — lets a large channel's history be sized cheaply
  (title + position only, no per-video fetch) before committing to the
  expensive part.
- **Real bug found and fixed in `discover_channel.find_historical_candidates()`
  before this could be trusted**: its scope-cutoff detection relies on
  parsing dates out of video titles, guarded by a "don't trust an
  implausible jump" check originally written for a real ZIZ title typo
  (a stray "January 14, 2022" sitting between two January 2023 uploads).
  That guard was symmetric — it rejected a big jump in EITHER direction
  — which is wrong for a walk that's newest-to-oldest by construction:
  a large *backward* jump is completely normal (a channel that goes
  months between uploads), only a *forward* jump (a date newer than the
  running anchor) is a real anomaly. Confirmed live: PLP's channel
  walked all the way back through 2022 campaign-rally uploads without
  the scope-cutoff check ever engaging, because the old symmetric guard
  kept discarding every correctly-ordered older date as "implausible,"
  leaving the anchor stuck near its first (often noisy) value. Fixed by
  only rejecting forward jumps (`parsed > last_confirmed_date + 3 days`
  tolerance); reverified afterward — PLP now correctly stops at "Crossed
  scope cutoff at 2022-08-04." Talk SKN's titles carry no dates at all
  (0 of 66 candidates parsed a date) — the cutoff check simply can't
  engage there either way, so that channel leans entirely on Gemini's
  own extraction-time scope rule as the backstop (see "Stance
  misattribution bug" above — already proven live to correctly reject
  out-of-scope content on its own).
- Launched detached (`setsid nohup ... & disown`, per the rule below)
  against all four opposition-side channels 2026-08-31: Talk SKN
  (`--limit 30 --max-pages 5`, small channel, fully covers its 66-video
  history), Straight Talk (`--limit 25 --max-pages 60`, longer-running
  channel, doesn't reach 2022 within even 300 candidates/6 pages — this
  run only makes a dent, not a full catch-up), PLP (`--limit 25
  --max-pages 5`, fully covers its 67 in-scope candidates), PAM
  (`--limit 25 --max-pages 5`, first-ever discovery run against this
  channel, 173 total videos). Straight Talk in particular will need
  several more deliberate runs to reach all the way back to Aug 2022,
  same "several runs, not one unbounded sweep" pacing as ZIZ's own
  backlog.

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
| `transcript_segments.speaker_name_at_time` (the actual named individual per claim, distinct from `speaker_title_at_time`'s role — see "Named opposition speaker filtering" below) | ✅ Migrated | 2026-08-31 |
| `claims.featured` (curated-view flag, independent of `review_status` — see "Curated-view noise filtering" below) | ✅ Migrated | 2026-08-31 |
| `suggestion_themes`, `citizen_suggestions`, `suggestion_acknowledgements` (tables) — see "Suggest a Priority" below | ✅ Migrated | 2026-08-31 |
| `claims.manual_clarification_id` (admin-linked clarification claim) | ✅ Migrated | 2026-08-31 |
| `claims.manual_clarification_title`, `_text`, `_url` (admin-written clarification — see "UI overhaul, demo-readiness cleanup" below) | ✅ Migrated | 2026-09-01 |

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

## Stance misattribution bug — found and fixed (2026-08-31)

Caught by the person who commissioned this project spot-checking live
data against a real current Cabinet list, not by any automated check —
worth remembering as a gap in the review process, not just a code bug.
Two distinct, confirmed errors, both from the same root cause
(`extract_from_video.py`'s `stance` field judged tone/criticism alone,
never checked WHO was speaking or WHICH administration a claim was
actually about):

1. **Sitting SKNLP ministers mislabeled `opposition_statement`.**
   `KNOWN_FIGURES` only listed Dr. Terrance Drew by name — the other 8
   current Cabinet ministers (Hanley, Douglas, Maynard, Henderson,
   Duggins, Clarke, Wilkin, Phillip) weren't on it. On ZIZ's mixed-speaker
   National Assembly sitting footage, when one of these ministers
   criticized the PREVIOUS (Team Unity) administration on the floor —
   completely normal government messaging — the model saw "criticism"
   and tagged it opposition_statement. 8 real claims hit this, 6 already
   `approved` and publicly live (e.g. "Alleged Mismanagement of $14.4M on
   Basseterre High School" — Prime Minister Drew's own claim, shown as an
   opposition statement). Corrected: reclassified to
   `stance='accomplishment'` and pulled back to `pending_review` for a
   human sanity check before re-publishing (not silently re-approved).
2. **A previous administration's own record mislabeled as an SKNLP
   `accomplishment`.** When Timothy Harris (PLP leader, former PM) or
   Mark Brantley described something the 2015-2022 Team Unity
   administration did (e.g. "Zero COVID-19 Deaths Through December
   2020", "Passage of Freedom of Information Act in 2018") — their own
   record, praised by them, nothing to do with SKNLP or the current
   government at all — it got extracted and tagged `accomplishment`,
   crediting SKNLP with a different party's history. 19 claims hit this,
   most already `approved` and live. This is worse than case 1: not a
   stance-side flip, the content doesn't belong on this archive under
   *either* stance value (wrong administration, and several also predate
   the Aug 5 2022 scope cutoff outright — see "Scope window" above).
   Corrected: `review_status='rejected'` — removed from public view
   entirely, not just relabeled.

Root-cause fix in `extract_from_video.py` (not just a data patch):
- `KNOWN_FIGURES` now lists the full current Cabinet with explicit
  `SKNLP` affiliation tags, plus opposition figures with their own
  affiliation — so the model has an explicit current-affiliation lookup
  instead of inferring side from tone.
- `candidate_claims`' schema description adds an explicit scope rule:
  a claim solely about a PREVIOUS/different administration's own record
  — regardless of who states it or whether favorably or critically — is
  excluded from extraction entirely, not assigned either stance value.
- The `stance` field's description now explicitly separates "who is
  speaking" from "which administration the content is about," and
  states directly that a CURRENT minister criticizing the PREVIOUS
  administration is still `accomplishment` (the current government's own
  narrative), never `opposition_statement`, just because the tone is
  critical.
- Both the government-side (`run_batch.py`, ZIZ) and opposition-side
  (`run_channel_discovery.py`, Talk SKN/Straight Talk/PLP) detached
  processes that were running when this was found were killed and
  restarted from the fixed code — anything they'd already written before
  the kill was left untouched (already verified correct in the audit
  above); anything not yet extracted gets the fixed prompt.
- **Update 2026-08-31, same day**: the opposition-side audit was done.
  Confirmed case 2 (previous administration's own record, wrong party
  entirely) is real on these sources too, worse than expected — PLP's
  own channel is naturally full of it (a PLP convention/press event is
  Timothy Harris crediting "the PLP/Team Unity administration" for its
  own record; 6 of 6 accomplishment-tagged PLP claims were this pattern)
  and Straight Talk had 2 more (one explicitly Team Unity-attributed SIDF
  funding claim, one a genuinely out-of-scope 2011 National Energy Policy
  claim — predates even Team Unity, caught by the base "Scope window"
  rule above, not just the stance rule). Also re-examined the two ZIZ
  claims left alone in the first pass ("Island Main Road Resurfacing
  Project", "Defense of Team Unity Good Governance Legislative Record",
  both Timothy Harris crediting Team Unity's own record) against the
  now-explicit standard and rejected those too, for consistency — they'd
  been left as opposition_statement on a looser first-pass read before
  the "praising your own prior administration is out of scope entirely,
  not just criticism of it" rule was written down explicitly. Case 1 also
  recurred once outside ZIZ: PM Drew's own $400M geothermal cost estimate
  from a press conference, quoted by Straight Talk, was tagged
  opposition_statement purely because the surrounding episode was
  critical — fixed the same way (stance -> accomplishment, back to
  pending_review). Total this round: 10 claims rejected (wrong
  administration/out of scope), 1 reclassified. Talk SKN's
  accomplishment-tagged claims were all checked and are correctly
  current-government content — no case 2 hits there specifically.
- Separately noticed, not yet fixed: two of the corrected claims had a
  wrong `transcript_segments.speaker_title_at_time` (PM Drew's segment
  showing "Attorney General" / "Speaker of the National Assembly")  —
  likely Gemini merging adjacent procedural speaker turns into one
  broad raw segment during a very long multi-hour chunk, not a bug in
  `compute_segment_window()`'s matching logic itself (spot-checked). The
  claim's own `summary` text correctly named the real speaker in both
  cases, so this is a display-only nit on the timestamp citation, not a
  factual/stance error — lower priority than the two bugs above but
  worth a closer look if it recurs.

**Correction, 2026-08-31, later same day**: case 1's fix above was
itself too broad, caught live by the person who commissioned this
project spot-checking the Dashboard directly ("you need to be careful
about what is pegged as an accomplishment... this does not belong",
pointing at "Alleged $14 Million Dirt Management Cost at Basseterre High
School" — Konris Maynard alleging the *previous* administration wasted
$14M without building a functional school). Case 1's original fix
reclassified ANY "current minister criticizing a previous administration"
statement to `accomplishment`, using almost this exact scenario as its
own justifying example ("the PM alleging the prior government
mismanaged a project"). That's wrong: a bare allegation about what the
PREVIOUS administration itself spent, built, or decided is still solely
about the previous administration's own record — regardless of who
currently holds office and says it — and belongs excluded per the
CRITICAL SCOPE RULE, not accomplishment. The distinction that actually
matters: does the claim describe the CURRENT government's own resulting
action (an audit ordered, a law amended, funds recovered), with history
as context — or is the claim itself just "X was spent/built/decided
under the previous government," with no current action attached? Only
the former is legitimately accomplishment-side.

- **Cheap audit signal**: every one of these misclassified claims had
  `accomplishment_type IS NULL` — the classifier itself apparently
  couldn't honestly fit them into any of the four real categories, which
  in hindsight was the tell. Queried all `stance='accomplishment'`
  claims (approved + pending) with `accomplishment_type IS NULL` — a
  small, cheap set (11 claims) — and judged each individually
  (title/summary/citizen_impact) against the corrected test above rather
  than reapplying a blanket rule. Rejected 4 (two Basseterre High School
  "prior government wasted $X" claims including the one flagged live,
  a "previous administration's Poverty Alleviation enrollment" claim, a
  "criticism of the previous administration's 2022 water budget cut"
  claim — all pure narrations of the prior administration's own
  spending/decisions with no current-government action described).
  Kept and assigned a real `accomplishment_type` to the other 7 — genuine
  current-government content that simply hadn't been typed yet (COVID
  travel restrictions lifted, the FOI Act's dormant 2018 law finally
  activated by current amendments, the $400M geothermal cost estimate,
  land double-booking audits/disclosures, the Development Bank
  unaccounted-cash finding — each of these describes a CURRENT action,
  even where a historical failure is the context). One of the 7
  ("Immediate Closure of Irish Town Primary School") is legitimately a
  current-government action but reactive/isolated, not a policy win —
  kept as `accomplishment` stance (correct) but set `featured = false`
  (see "Curated-view noise filtering" above) rather than forced into a
  stance/scope box it doesn't belong in either.
- **Root-cause fix**: `extract_from_video.py`'s `candidate_claims` scope
  rule and `stance` field description both rewritten to explicitly say
  this exclusion applies with equal force to a CURRENT official's own
  words, using this exact Basseterre High School example as the
  documented counter-example so it can't recur the same way twice.
  Added a concrete self-check for the model: if the only honest
  `accomplishment_type` for a claim would be none of the four real
  categories, that's itself a signal the claim is out-of-scope, not an
  accomplishment with a blank type. `extract_from_article.py` got the
  matching (shorter) correction for the same reason.
- **Not yet done**: a full comprehensive pass across every
  `accomplishment`-stance claim (not just the `accomplishment_type IS
  NULL` subset) for this same pattern, once the concurrent ingestion
  backlog (ZIZ historical batch, opposition discovery) settles down —
  the NULL-type signal caught the clearest cases cheaply, but a claim
  could in principle have been assigned a plausible-but-wrong
  `accomplishment_type` and not surface this way. Flagged here, not
  silently assumed complete.

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

## SKNIS website ingestion (built 2026-08-31)

Prompted by a real, demonstrated gap: asking "Ask the Record" about the
Destiny project could only surface opposition allegations, because the
government's own direct statements on it exist only as SKNIS
(sknis.gov.kn) press releases — pure text, no video — so the video-only
pipeline had zero access to them. `sources_registry` had an SKNIS row
already (`platform='sknis'`, id `4ba9a62b-7ac6-46ea-948d-1179890060ba`),
but per the "Ingestion agent" section above, a registry row alone
ingests nothing — there was no text-extraction pipeline at all until
now, the same gap already flagged for WINN FM/Freedom FM/ZIZ's own news
sites (still true for those three; only SKNIS is built).

**Confirmed real and worth building**: sknis.gov.kn is WordPress with a
live RSS feed (`/feed/`) and ministry-tagged categories matching the
current Cabinet. Sitemap math (19 post-sitemap pages) puts the in-scope
window (Aug 2022+) at roughly 3,800 posts, ~80/month — real volume, not
overwhelming. Noise is real too (job postings, generic notices, event
photos) — needs the same high-value filtering ZIZ's historical backfill
already established.

- `ingestion/extract_from_article.py` — sibling to `extract_from_video.py`,
  reuses its constants directly (`CATEGORIES`, `SENTIMENTS`,
  `ACCOMPLISHMENT_TYPES`, `KNOWN_FIGURES`, `normalize_accomplishment_type`,
  `_generate_with_retry`) rather than redefining them, same conservative
  extraction philosophy and scope rules. No video/audio, so no chunking
  and no timestamps — citation is just the article URL. `fetch_article()`
  targets the theme's `entry-content` div specifically, not a generic
  `<article>` tag — confirmed live this WordPress theme reuses `<article>`
  for sidebar/"related posts" widgets too, so the naive selector grabbed
  an unrelated widget headline every time before this fix.
- **Speaker attribution is coarser than video's**: one article's primary
  speaker goes on `sources.speaker_name`/`speaker_org` directly (both
  already-existing columns), not a per-claim `transcript_segments` row —
  there's no timestamp to anchor one to. Covers the common case (most
  SKNIS releases are single-official statements); a genuine multi-official
  roundup article loses per-claim speaker granularity. Documented gap,
  not a silent one — same posture as every other scoping decision here.
- `ingestion/run_article_ingestion.py` — the write path, same safety
  guarantees as `run_ingestion.py` (`pending_review` verified before
  commit, whole transaction rolls back on any deviation).
- **Corroboration linking — the actually-new mechanism, per explicit
  instruction** ("some of these will be duplicated by youtube... this is
  where we will be able to buttress sources by stating the various
  sources that talk about the same thing"). `claim_sources` was already
  a many-to-many join table, and the claim detail page already renders
  `"Documented with N independent sources"` — that path existed but
  nothing had ever exercised it, since no ingestion script ever checked
  "does an approved claim for this fact already exist" before inserting.
  `find_matching_approved_claim()` now does: same stance/category,
  `pg_trgm` `similarity(title, ...)` above `MIN_SIMILARITY = 0.35` to
  narrow to real candidates, then `_is_same_claim()` — one Gemini call
  per candidate asking whether it's genuinely the same specific fact, not
  just the same topic/institution — same two-stage pattern (cheap
  pre-filter, then real relevance judgment) that fixed the Opposition
  Watch record-pairing bug, reused here because the failure mode is
  identical: title/category similarity alone isn't reliable enough to
  act on by itself, and merging two genuinely different claims under one
  id would misattribute a citation — worse than the duplicate it's
  avoiding. Verified live: a geothermal-funding SKNIS article correctly
  did NOT merge with an existing "CDB Approval" claim (different funding
  milestones, Dec 2022 CDB approval vs. Feb 2025 full-financing-secured —
  related but genuinely distinct facts) — the conservative call is
  exactly right there, not a miss.
- `ingestion/run_website_discovery.py` — RSS-based discovery mirroring
  `run_channel_discovery.py`'s role for YouTube channels, with a noise
  filter (`is_probably_relevant()`, job/vacancy/notice/tender patterns)
  before extraction is even attempted. Same RSS-feed limitation as
  YouTube's discovery script: only reaches the ~10 most recent items,
  no pagination — a real historical backfill (the ~3,800-post in-scope
  window) needs a sitemap-walking approach like ZIZ's
  `find_historical_candidates`, not yet built.
- **Live-verified end to end**: ingested the 4 real SKNIS statements on
  the Destiny project (Nov 2025 – Jul 2026) plus a small recent-articles
  batch. Asking Ask the Record "What is the government's position on the
  Destiny project?" now correctly answers from the government's own
  statements instead of finding nothing beyond opposition allegations —
  the exact gap this was built to close.
- **Not yet built**: the sitemap-based historical backfill (above);
  applying the same text-extraction pipeline to WINN FM/Freedom FM/ZIZ's
  news sites (same WordPress/RSS shape, untested against them
  specifically).
  **Update 2026-08-31, same day**: corroboration-linking is no longer
  SKNIS-only — see "Corroboration and duplicate merging" below, which
  wires `find_matching_approved_claim()` into the video pipeline
  (`run_ingestion.py`) too, prompted by a real 4-way duplicate (the
  EC$250 back-to-school voucher, fragmented across Talk SKN, Straight
  Talk, and two SKNIS articles) that the SKNIS-only version couldn't
  have caught since two of the four sources were video.

## Chatbot objectivity — richer synthesis, plus a narrow contradiction exception (decided 2026-08-31)

Prompted directly: "can the chatbot be objective also? as in, taking in
all context and give an informed answer, as opposed to just what it does
now?" This runs straight into the product's own "never render a verdict"
rule (see "Non-negotiable rules" below), so the answer isn't a redesign —
it's two additive, carefully scoped changes, confirmed with the user
before building ("I think a mixture of both 1 and 2 works. When it's
HEAVILY leaning on a side, it can be option 2, after providing richer
synthesis."):

1. **Richer synthesis, always on.** `retrieve()`'s `LIMIT` went from 3 to
   5, and the `ANSWER_TOOL` schema's `summary` field description loosened
   from "1-2 sentences" to allow more when genuinely synthesizing
   multiple relevant retrieved claims — the model should use everything
   relevant in context, not just echo the single closest match.
2. **A narrow, symmetric, evidence-based contradiction exception —
   system-prompt rule 3c.** Deliberately biased toward *not* invoking it:
   only for a direct, specific, checkable factual contradiction between
   two retrieved rows (e.g. a claimed date vs. a documented different
   date), never a "who's more credible" characterization, and applies
   identically regardless of which side (accomplishment or
   opposition_statement) is contradicted — this is what keeps it from
   becoming a backdoor verdict mechanism. Written into both
   `app/api/ask/system-prompt.ts` and `chatbot_system_prompt.md` (kept in
   sync, as always).
3. **The 'related' cross-reference note.** `retrieve.ts`'s
   `findRelatedRecordsForOpposition()` tags a category-matched-but-not-
   keyword-matched clarification row `match_type: 'related'`; the context
   block now explicitly flags this to the model so it's never mistaken
   for a row the user's own words actually matched — same "clarification,
   not confirmation" posture as Opposition Watch's own pairing logic.

**Not yet live-tested against a real contradiction**: no genuine
factual-contradiction pair existed in the corpus at implementation time
(checked specifically for a Marriott-loan "without approval" case and
found none) — rule 3c is implemented defensively but unverified against
real data. Test it against a real case the first time one shows up in the
corpus, rather than assuming it works as designed.

## Corroboration and duplicate merging — now cross-pipeline (decided 2026-08-31)

Prompted directly, with a concrete example: "You also need to watch for
duplicate entries. When context looks identical or closely matching,
please combine and add the various sources that it's coming from" — the
EC$250 Back to School Voucher Initiative existed as **four** separate
claims (Talk SKN, Straight Talk, two SKNIS articles) instead of one claim
with four `claim_sources` rows. Two distinct root causes, both fixed:

1. **The video pipeline never checked for an existing match at all** —
   only `run_article_ingestion.py` called `find_matching_approved_claim()`.
   `run_ingestion.py` now calls it too, before inserting each candidate
   claim; a match links the new source to the existing claim instead of
   creating a duplicate.
2. **The matching function itself was too strict** —
   `find_matching_approved_claim()` originally required an exact
   `category` match before even comparing two claims, so the same real
   fact tagged "Education" by one extraction pass and "Social Protection"
   by another was never compared at all. Fixed by dropping the category
   filter (stance is still required) and comparing `title || ' ' ||
   summary` combined rather than title alone — pulled the shared logic
   into `ingestion/claim_dedup.py` so both pipelines use the identical
   function, not two copies that can drift.

The EC$250 cluster itself was merged manually (canonical claim now has 6
sources after also catching a couple of near-duplicates in the same
sweep). **Retroactive backfill for everything else ingested before this
fix**: `ingestion/backfill_dedup.py` — same two-stage pattern
(`pg_trgm` `similarity()` pre-filter, then one LLM call per candidate
pair confirming it's genuinely the same specific fact, not just the same
topic/institution) applied all-pairs across the whole approved-claims
table instead of one-new-claim-against-a-few-candidates. Needed its own
higher threshold, `BULK_MIN_SIMILARITY = 0.45` — reusing the live path's
`MIN_SIMILARITY = 0.2` against every pair of ~600 approved claims
produced 11,550 candidate pairs (confirmed empirically before this script
existed: genuine duplicate clusters score ≥0.45 on this metric; below
that is normal topical overlap between genuinely distinct claims, not a
duplicate signal). Run 2026-08-31: 53 candidate pairs at the 0.45
threshold, 32 confirmed as genuine duplicates and merged (keeping the
older claim, by `created_at`, as canonical; the newer one's
`claim_sources`/`claim_transcript_segments` rows are relinked, never
dropped, then it's set `review_status = 'rejected'` — no source or
citation is ever deleted, only consolidated onto one claim).

## Curated-view noise filtering (`claims.featured`, decided 2026-08-31)

Prompted directly: "we also need to do a site-wide audit and make sure
we're not importing noise and generic news items. We need to focus on
government-centered stuff. Rescuing people from a sinking ship is good.
Arresting people, etc... not for this initiative... Some of the stuff can
be used to answer chatbot-related questions right? But some of them just
do not need to be front facing." Two real constraints in tension: the
corpus needed to stay searchable (a rescue, an arrest, a crime statistic
is still a real fact someone might ask the chatbot about) while the
curated public views needed to stay focused on actual government
policy/delivery, not read as "a glorified news site."

Resolved as two independent axes rather than one, deliberately not
reusing `review_status` for this: `review_status` still gates whether a
claim is real/public/citable at all; `claims.featured BOOLEAN NOT NULL
DEFAULT true` gates only whether it appears in the *curated* browsing
views. `getDashboardClaims()`, `getTimelineClaims()`, and
`getDashboardStats()` all gained `AND c.featured = true`; Ask the Record
(`retrieve.ts`) and Opposition Watch (`oppositionWatch.ts`) do **not**
filter on it — both continue to search/surface every approved claim
regardless of `featured`, which is the whole point (a ferry rescue is
appropriately absent from the Dashboard grid but still a correct answer
if someone directly asks the chatbot about it).

- Written directly by the ingestion agent going forward (`extract_from_video.py`
  and `extract_from_article.py`'s `RESPONSE_SCHEMA` both gained a
  `featured` field with explicit true/false guidance — the rule of thumb
  is whether the claim fits one of the four `accomplishment_type`
  categories; if not, it's very likely noise, not front-page material).
- **Retroactive backfill**: `ingestion/backfill_featured.py`, same
  batched-Gemini-classification pattern as the other backfill scripts.
  Dry run against the 588 pre-existing approved claims proposed 111
  `featured=false`. **Spot-checked against the DB before applying** and
  found the classifier's own stated rule of thumb was violated on a
  handful of items — most notably three genuine water-infrastructure
  claims (Newton Ground/Saddlers/Cayon well drilling) that already
  carried a real `accomplishment_type` of 'Ongoing Initiative'/
  'Accomplishment' in the DB, and which CLAUDE.md itself already cites
  elsewhere as real government delivery content (the well-drilling
  initiative used as Cayon water-shortage clarification context) — plus
  two more (the ASPIRE student-savings match, diversionary-caution
  digital-framework training) that are real named government programs,
  not isolated incidents. These five were corrected back to
  `featured = true` by hand after applying the backfill; the remaining
  ~106 (tourism/passenger-arrival statistics, crime/homicide stats,
  ceremonial and diplomatic events, awards, funerals, the Apple Syder
  ferry rescue) matched the intended noise definition and were left
  `featured = false`. Worth another look if the same pattern (a
  claim already carrying a real `accomplishment_type` gets proposed
  `featured=false` anyway) recurs at volume — the classifier's
  narrow-specific-headline style ("175 Gallons Per Minute") appears to
  read as similar in *form* to the isolated-incident examples
  (a rescue, an arrest) even when the underlying content is a genuine
  policy delivery, which is the actual distinction that matters.
- Review Queue (`ReviewQueueClient.tsx`) got a checkbox alongside every
  accomplishment/opposition claim so an admin can correct this call at
  any time without unapproving the claim, same "editable after the fact"
  posture as `accomplishment_type`.

## Suggest a Priority (built 2026-08-31)

Prompted directly: a public anonymous suggestion box ("what do you want
to see from the labour government") plus a structured admin-side review
workflow — grouping similar submissions even when worded completely
differently, surfacing the most-mentioned ones, and letting an official
acknowledge one with a comment "for further consideration." This extends
`design-reference/source-manager-mockup.html`'s already-sketched "Suggest
a Priority" / "Trending Suggestions" sections rather than starting from
scratch — those were speced but never built (see "Design reference"
above).

- **Schema**: `citizen_suggestions` (raw anonymous text, one row per
  submission, never edited), `suggestion_themes` (the cluster several
  submissions can share — label, category, status), and an append-only
  `suggestion_acknowledgements` (same posture as `audit_log` — a real
  attributable administrative action, never silently overwritten).
  Deliberately no IP/session/identity column anywhere in this group —
  same explicit anonymity promise already made for `chat_queries`, and
  the rate-limit check on the public submit endpoint uses the IP only as
  an in-memory key (`app/lib/rate-limit.ts`), never persisted.
- **Public page**: `/suggest` (`app/suggest/`) — anonymous textarea,
  500-char cap, rate-limited. **Admin page**: `/source-manager/suggestions`
  (`app/source-manager/suggestions/`) — themes ranked by mention count
  (the "most pressing" signal requested), each expandable to show sample
  raw submissions and an acknowledge form (name + comment → flips theme
  to `under_consideration`, logs the acknowledgement). Linked from the
  main Source Manager page; no site-wide nav exists yet to also link it
  from the public side (see CLAUDE.md's Design reference note that nav
  is only in the mockup so far), so `/suggest` isn't discoverable from
  anywhere in the live app yet — worth a real nav entry before the demo.
- **Tagging**: reuses the existing claims `CATEGORIES` taxonomy
  (`app/lib/categories.ts`, mirrored from `ingestion/extract_from_video.py`)
  rather than a second taxonomy to maintain — "childcare"/"social
  program" asks land under `Social Protection`, which already existed.
- **Clustering, and two real bugs found testing it live**: classification
  + clustering happens live per submission (Claude Haiku, tool-use,
  `app/lib/citizenSuggestions.ts`), not a periodic batch job. First
  attempt reused claim_dedup.py's exact two-stage pattern (pg_trgm
  pre-filter, then one LLM same-theme call) — wrong tool for this job,
  confirmed by seeding real mock submissions and inspecting the result:
  "We need more job programs for young people who just finished school"
  and "Youth unemployment is a real problem, please create more
  internship opportunities" scored too low on `similarity()` to even
  reach the LLM judgment, landing as two separate themes for the same
  ask — unlike claim titles/summaries, which usually share verbatim
  entity names or dollar figures, two citizens paraphrasing the same
  wish in their own words often share almost no literal substrings.
  Fixed by dropping the trigram pre-filter entirely for this feature and
  scanning the `THEME_SCAN_LIMIT` (15) most recently active themes
  directly with the LLM — affordable at the low-to-moderate volume this
  feature will actually see. **Second bug, found in the same test
  pass**: with the pre-filter gone, the LLM's same-theme judgment turned
  out to be too permissive in the other direction — "childcare is
  unaffordable," "housing is unaffordable," and "cost of living is too
  high" all merged into one theme, because they share a broad problem
  area even though they're different specific asks. Fixed by rewriting
  `SAME_THEME_TOOL`'s description to explicitly require the same
  *specific* ask, not just the same general problem area, naming this
  exact failure case directly in the prompt. Re-seeded and reverified
  after each fix: 20 realistic mock submissions across 14 themes,
  correctly separating childcare/housing/food-price/general-cost-of-
  living into distinct themes while still merging true duplicates (two
  independently-worded youth-unemployment submissions, two independently-
  worded rural-broadband submissions, etc.) — spot-checked by hand, not
  assumed from the code.
- **Mock data**: seeded through the real `/api/suggestions` endpoint
  (not hand-inserted rows), so it exercises the actual classification/
  clustering path — 20 submissions via `curl` with synthetic
  `X-Forwarded-For` values to spread them across the per-IP rate limit,
  same way distinct real citizens would. Not committed as a script;
  re-run similarly if the demo data needs regenerating. Truncate all
  three tables first if reseeding (`TRUNCATE suggestion_acknowledgements,
  citizen_suggestions, suggestion_themes;`) since clustering is stateful
  across the existing corpus.
- **Not yet built**: real admin auth (the acknowledge form takes a free-
  text official name, same maturity level as the rest of this app's
  admin surfaces — no `admin_users` wiring anywhere yet); a public nav
  link to `/suggest`; multiple acknowledgement rounds aren't specially
  surfaced beyond a chronological list (fine at this volume, revisit if
  a theme accumulates many).

## UI overhaul, demo-readiness cleanup, and a second clarification path (2026-09-01)

Prompted by a live product review with the person who commissioned this
project, ahead of an end-of-week demo. Several distinct decisions, each
noted below.

**Free-text manual clarification, alongside the existing link-an-existing-
claim path.** Real objection raised directly: "the search to link for a
clarification is searching for keywords and to be honest, if your LLM
could not find a cogent match, i dont think a human would." Most real
government clarifications won't already exist as their own ingested
claim, so requiring one was too narrow. `claims.manual_clarification_title`
/ `_text` / `_url` (all TEXT, nullable) let an admin write the
clarification directly with a source URL as the citation — still never
bare unsourced text (`url` required whenever title/text are set,
enforced in `reviewQueue.ts`'s `updateManualClarificationText`), still
never bypassing the "everything traces to a real source" rule, just a
lighter-weight source (a URL) than a full ingested claim. Mutually
exclusive with `manual_clarification_id` per claim (setting one clears
the other) so there's never ambiguity about which clarification is
live. Same "Clarified by admin" tag and same priority-over-auto-match
posture in `oppositionWatch.ts`/`claims.ts`/`retrieve.ts` as the
existing linked-claim path. The chatbot path (`retrieve.ts`) had a real
bug here: a synthetic non-UUID id (`manual:<claim-id>`) for the written-
clarification case would have crashed `logChatQuery`/`getFollowUpQuestions`
(both expect a real `claims.id` UUID) — fixed in `app/api/ask/route.ts`
by only passing a real claim id downstream when the matched citation
actually has one.

**Scope-integrity sweep, prompted directly**: "we dont need anything in
the future...2028 is marked as a date for something, even in the
timeline!" Found and fixed two distinct bugs, both worth tracking since
they recur as more content gets backfilled:
- A future `event_date` on the curated Dashboard/Timeline: one genuine
  extraction bug (an opposition claim's `event_date` was set to a future
  deadline *mentioned in* the claim's text — "phase out CBI by June 1,
  2028" — not when the claim was actually made) and one legitimate
  future-scheduled-event announcement. Both now excluded via a
  `(c.event_date IS NULL OR c.event_date <= CURRENT_DATE)` guard added
  to `getDashboardClaims`/`getDashboardStats`/`getTimelineClaims` — this
  project documents what's been done, not a forward calendar.
- Manually swept for the OTHER direction too (event_date before this
  administration's Aug 5 2022 start) while investigating why the
  Dashboard's "years covered" stat read 2005–2026 instead of 2022–2026.
  Found and rejected 3 genuine scope violations that had slipped past
  the extraction-time CRITICAL SCOPE RULE (a 2005 Marriott Hotel jobs
  claim quoting Denzil Douglas describing pre-Team-Unity events, a 2019
  Team-Unity-era cannabis decriminalization claim, a May 2022 conference
  hosted before the Aug 5 cutoff) and corrected one date-field bug (a
  claim citing a "2010 WIPO study" had the *study's* year in
  `event_date` instead of when the citing minister actually spoke —
  nulled, not rejected, since the claim itself is legitimately about a
  current minister's statement). **Not yet done**: this was a manual
  one-off sweep (`WHERE event_date < '2022-08-05'`), not a repeatable
  script — worth turning into one and re-running periodically as the
  opposition-side historical backfills (Straight Talk especially, which
  hasn't reached 2022 yet) keep adding older content.

**Timeline is accomplishment-stance only now.** Prompted directly: "we
dont need a timeline for opposition statements! The timeline is to make
the govt look good!" `getTimelineClaims()` gained `AND c.stance =
'accomplishment'` — Ask the Record and Opposition Watch remain the
neutral, both-sides surfaces; the Timeline (like the Dashboard) is
explicitly the government's own curated record, not a neutral claim log.

**Dashboard stat renamed.** "752 Documented accomplishments" was
misleading — the count includes Policy Decisions, Strategic Decisions,
and Ongoing Initiatives, not just completed accomplishments (see
"Accomplishment sub-typing" above). Relabeled "Documented actions &
decisions" in `app/page.tsx`.

**Suggestions backend hardening**, prompted directly: "the suggestions
back-end will need some refining as it could blow up very quick and we
need to weed out spam, message bombing, etc." Two changes:
1. `app/lib/rate-limit.ts` now supports named limiter configs instead of
   one shared bucket — `/api/ask` keeps its original 10-per-60s
   (reasonable for a chat conversation's follow-ups), `/api/suggestions`
   gets a dedicated, much stricter `SUGGESTION_LIMITER` (3 per 10 min per
   IP) since a citizen has no legitimate reason to submit several
   priority suggestions in quick succession.
2. `citizenSuggestions.ts`'s classification call now also moderates in
   the same pass (one call, not two) — `is_genuine_suggestion` rejects
   spam, advertising, gibberish, and abuse, throwing a new `ModerationError`
   that `app/api/suggestions/route.ts` returns as a 422 with the model's
   own short reason. Deliberately fails OPEN (submission proceeds
   unclassified/unclustered) on a transient LLM error, same posture as
   classification always had — an API hiccup should never make the
   public submission box appear broken, and a rare piece of spam
   slipping through during an outage is a smaller cost than blocking all
   legitimate citizen input. **Not a complete anti-abuse system** — no
   CAPTCHA, no cross-IP duplicate-content detection; good enough for a
   demo at expected volume, flagged here rather than assumed sufficient
   if this ever goes to real public traffic.

**Site-wide navigation, built from scratch.** The real app never had the
mockup's sidebar wired up — every page was a standalone island with no
way to reach any other page except by typing a URL. `app/components/Nav.tsx`
+ `nav.module.css` (persistent left sidebar, `app/layout.tsx`) replicates
`design-reference/mockup.html`'s sidebar structure and colors, grouped
"Browse" (public: Dashboard, Ask the Record, Opposition Watch, Timeline,
Suggest a Priority) vs "Internal" (admin: Review Queue, Source Manager,
Trending Suggestions). Internal items get a visually distinct gold active
state (vs. the public red) plus an "Admin" badge — requested directly:
"internal pages with a different color button as this is just the proof
of concept." Removed the ad-hoc `topLinks` row that used to live only on
the Dashboard (superseded). Speakers and Calendar are NOT in the nav —
those two views only ever existed in the mockup, never built as real
pages (see "Data model" above) — flagged here rather than silently
omitted.

**Renaming pass**: Opposition Watch's on-page H1 "CLAIM, MEET RECORD" →
"CLAIMS & CLARIFICATIONS" — flagged directly as not landing well; the new
one matches the terminology already used everywhere else on that page
(the Clarified/No clarification yet pills).

## Timeline UI cleanup + Ask latency investigation (2026-09-01)

Prompted directly: "dont forget, in timeline view, i dont want opposition
stuff and we need to change it from 'accomplishments' to something more
fitting." The backend filter (`getTimelineClaims()`, previous entry) was
already live and correct — 0 opposition rows confirmed in the actual
response — but the UI still had dead leftovers: an Everything /
Accomplishments / Opposition statements filter row that was now
pointless (opposition can never appear), and a per-item tag that
branched on `isOpposition` (always false). Removed the dead filter row
and simplified `TimelineItem` to always show the specific
`accomplishment_type` label (Accomplishment/Policy Decision/Strategic
Decision/Ongoing Initiative) rather than a generic bucket — same
"specific type, not a blanket label" fix as the Dashboard stat rename.
Page subtitle also still said "documented accomplishment and public
statement" (a leftover both-stances framing) — corrected to "action,
decision, and initiative."

**Ask the Record latency — measured, not guessed.** Prompted directly:
"is this searching raw records or have we vectorized this whole thing?"
Added temporary timing instrumentation (`console.error` around
`retrieve()` and the Anthropic call in `app/api/ask/route.ts`, kept in
as permanent lightweight logging) and measured real requests: `retrieve()`
(plain Postgres full-text search, `ts_rank` over the existing
`idx_claims_search_vector`/`idx_sources_search_vector` GIN indexes) took
39-246ms across three real questions — not the bottleneck, and
vectorizing/embeddings would not meaningfully improve this. The
Anthropic `claude-sonnet-5` call generating the actual answer took
2.6-11.1s and accounts for nearly all of the total latency. Presented
the client with the real tradeoff (switch to Haiku for speed vs. keep
Sonnet for quality); explicit answer: "because this is political, i
value accuracy highly... whatever decision you make, make sure we do
not lose that." **Decision: did not touch the model, context size, or
`max_tokens`** — the richer-synthesis/contradiction-handling behavior
(see "Chatbot objectivity" above) was specifically built on Sonnet-level
reasoning, and downgrading it for speed would directly risk the thing
just prioritized. Instead fixed the actual UX problem, which was a
silent multi-second wait reading as broken, not slow: `app/ask/ChatClient.tsx`'s
old loading indicator was a 10.5px `--faint`-colored static line reading
"Searching the record…" — both easy to miss and, per the measurement
above, now inaccurate about what's actually taking the time. Replaced
with a visible, animated indicator that rotates through honestly-worded
phrases ("Searching the record…" → "Reading the matching sources…" →
"Drafting a carefully sourced answer…") so the wait reads as the model
being careful, not the app being slow. **Real streaming (token-by-token
partial output) was considered and deliberately deferred** — it would
meaningfully improve perceived latency further, but re-plumbing a
tool-use response into a streamed one this close to the end-of-week demo
risks introducing a bug into the citation-validation logic that gates
this product's core credibility promise; worth doing as a real follow-up,
not rushed in now.

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
