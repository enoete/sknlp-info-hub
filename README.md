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
4. Ingestion agent — `ingestion/extract_from_video.py` wired to actually
   write `pending_review` rows into the database (currently prints JSON to
   stdout; needs a DB-writing wrapper). Run it against a test batch from
   each registered channel before trusting it at volume — accuracy on
   local speech patterns needs real verification, not assumption.
5. Opposition Watch — reuse the clustering/filter pattern already in the mockup
6. Calendar + Speakers — lower priority, can stay closer to mockup fidelity
7. Admin review queue — this now matters more than originally planned,
   since it's reviewing agent-drafted claims, not just manual entries.
   Needs to clearly surface `extraction_confidence` and flag
   `unknown_speaker` items for manual ID before they're approvable.

## Ingestion setup

```bash
cd ingestion
pip install google-genai
export GEMINI_API_KEY=your_key_here
python extract_from_video.py "https://youtube.com/watch?v=XXXX" --source-type official_party
```

Outputs JSON to stdout for now — the next step is a small wrapper that
takes that JSON and writes it into the database as `pending_review` rows,
plus a scheduled job that runs this against each `active` row in
`sources_registry` on its configured poll frequency.
