# SKNLP Info Hub

Sourced, dated record of SKNLP accomplishments and public statements, plus a
retrieval-only chatbot ("Ask the Record") and an Opposition Watch feature
that pairs opposition statements with the closest documented official record.

## What's in this starter

- `app/` — Next.js 14 App Router skeleton, brand tokens wired into Tailwind
- `design-reference/mockup.html` — the pixel-accurate reference build. Open
  this directly in a browser and treat it as the spec: every view (Dashboard,
  Ask the Record, Opposition Watch, Speakers, Calendar, Review Queue) is
  already built as working HTML/CSS/JS. The Next.js build's job is to turn
  this into real components wired to a real database.
- `schema.sql` — full Postgres schema (claims, sources, proof_documents,
  sources_registry, speakers, transcript_segments, audit_log, events)
- `chatbot_system_prompt.md` — the citation-mandatory system prompt for the
  "Ask the Record" chatbot. Non-negotiable rule: no source, no answer.
- `CLAUDE.md` — project context for Claude Code. Read this first.
- `deploy/` — nginx + pm2 configs for the DigitalOcean droplet

## Local development

```bash
npm install
npm run dev
# open http://localhost:3000
```

## Deploying to the DigitalOcean droplet (sknlphub.tekii.org)

Domain: `sknlphub.tekii.org`, pointing at droplet IP `104.236.15.123`. Confirm
the DNS A record (`sknlphub` subdomain → `104.236.15.123`) is set at your DNS
provider before starting — propagation can take up to a few hours, so do
this step first if you're on a tight timeline.

1. **Install Node, nginx, pm2, certbot** (once, on the droplet):
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
   sudo apt-get install -y nodejs nginx certbot python3-certbot-nginx
   sudo npm install -g pm2
   ```

2. **Get the code onto the droplet.** Either `git clone` your repo, or
   `scp -r` this folder up:
   ```bash
   scp -r sknlp-info-hub root@104.236.15.123:/root/sknlp-info-hub
   ```

3. **Install deps and build**, on the droplet:
   ```bash
   cd /root/sknlp-info-hub
   npm install
   cp .env.example .env.local   # then fill in real values
   npm run build
   ```

4. **Start with pm2** so it survives reboots/crashes:
   ```bash
   pm2 start deploy/ecosystem.config.js
   pm2 save
   pm2 startup   # run the command it prints
   ```

5. **Wire up nginx** as a reverse proxy in front of the Next.js process:
   ```bash
   sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/sknlphub.tekii.org
   sudo ln -s /etc/nginx/sites-available/sknlphub.tekii.org /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```

6. **Get HTTPS**:
   ```bash
   sudo certbot --nginx -d sknlphub.tekii.org
   ```

7. **Database**: install Postgres + the `pgvector` extension on the droplet
   (or use a managed DO Postgres cluster — simpler to operate, and this is
   the recommended path once this moves past demo stage). Run `schema.sql`
   against it, then point `DATABASE_URL` at it.

For a one-week demo timeline, a managed DO Postgres database (a few clicks
in the DO dashboard) will save you real setup time versus self-hosting
Postgres on the same droplet — worth the small extra monthly cost given the
deadline.

## Priority build order for the demo

1. Dashboard (claim grid + filters) — reads `claims` + `sources`, no auth needed
2. Claim detail view — citations + proof documents + related opposition claim
3. Ask the Record chatbot — wire `chatbot_system_prompt.md` to the Anthropic API with retrieval over `claims`
4. Ingestion agent — `run_ingestion.py`/`run_channel_discovery.py` write
   `pending_review` rows into the database (see "Ingestion setup" below).
   Run it against a test batch from each registered channel before
   trusting it at volume — accuracy on local speech patterns needs real
   verification, not assumption.
5. Opposition Watch — reuse the clustering/filter pattern already in the mockup
6. Calendar + Speakers — lower priority, can stay closer to mockup fidelity
7. Admin review queue — this now matters more than originally planned,
   since it's reviewing agent-drafted claims, not just manual entries.
   Needs to clearly surface `extraction_confidence` and flag
   `unknown_speaker` items for manual ID before they're approvable.

## Ingestion setup

The system Python here is PEP 668 "externally managed" (Debian/Ubuntu) —
a bare `pip install` fails. Use a venv, not `--break-system-packages`
(that risks the droplet's other apps' system Python):

```bash
cd ingestion
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
export GEMINI_API_KEY=your_key_here
export DATABASE_URL=postgresql://sknlp_app:PASSWORD@127.0.0.1:5433/sknlp_info_hub

# Only needed for videos long enough to exceed Gemini's 1,048,576-token
# input ceiling even at MEDIA_RESOLUTION_LOW (confirmed on real multi-hour
# National Assembly sittings) -- extract_from_video.py falls back to
# chunked extraction (video_chunking.py) for those, and chunking needs an
# exact video duration, which this key provides via the YouTube Data API
# v3 (free tier, 10,000 quota units/day, 1 unit per lookup). One-time
# setup: in the same Google Cloud project as GEMINI_API_KEY, enable
# "YouTube Data API v3" in Cloud Console, then reuse an unrestricted key
# or create a new one restricted to that API.
export YOUTUBE_DATA_API_KEY=your_key_here
```

Three entrypoints, all writing real `pending_review` rows (+
`transcript_segments` for deep-linking) into the database, never straight
to `stdout` only:

```bash
# One already-known video URL (a single_video-type sources_registry row):
./venv/bin/python3 run_ingestion.py --registry-id <uuid>

# Discover + ingest new uploads from a registered YouTube channel, capped
# at --max-new per run (default 3) so a channel with years of backlog
# doesn't get force-fed in one sweep:
./venv/bin/python3 run_channel_discovery.py --registry-id <uuid> --max-new 3

# Batch-ingest a filtered list of historical-backfill candidates (see
# discover_channel.py's find_historical_candidates()), skipping anything
# already ingested and stopping after --limit videos:
./venv/bin/python3 run_batch.py --registry-id <uuid> --candidates <path.json> \
    --categories "PM/Minister statement,Press conference" --limit 10
```

Videos long/short: `run_ingestion.py` and `run_batch.py` both call
`extract_with_chunking_fallback()`, which tries one direct call first and
only pays the much more expensive per-window chunked path
(`extract_long_video()`) if that fails with the specific token-ceiling
error — most videos never trigger it.

Both respect the Aug 5, 2022 scope cutoff (`scope_config.py`) and share
the same safety-verified write path (`ingest_one_video` in
`run_ingestion.py`) — every claims row is confirmed `pending_review`
before its transaction commits, or the whole run rolls back.

Not yet built: a scheduled job running `run_channel_discovery.py` against
every `youtube_channel`-type `sources_registry` row automatically, and
any discovery/extraction path for `website`-type rows (SKNIS press
releases, WINN FM, Freedom FM, ZIZ news, etc.) — only YouTube channels
are covered so far. Run it against a test batch from each registered
channel before trusting it at volume — accuracy on local speech patterns
needs real verification, not assumption.
