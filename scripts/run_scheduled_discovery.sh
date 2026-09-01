#!/bin/bash
# SKNLP Info Hub — cron entry point for ongoing, unattended discovery.
# Sets up the exact environment the ingestion scripts need (venv,
# DATABASE_URL pointed at the containerized Postgres, GEMINI_API_KEY from
# .env.local) and calls run_scheduled_discovery.py, which itself queries
# sources_registry for every eligible source rather than a hardcoded
# list. Logs to a rotating-by-date file so a bad run is inspectable
# after the fact without digging through cron's own mail spool.
#
# --max-new 3: modest on purpose -- this runs repeatedly (see crontab),
# not as a one-off backfill. A channel/site with a real backlog beyond
# 3 new items just gets it next run instead of all today.

set -euo pipefail

REPO_DIR="/root/sknlp-info-hub"
LOG_DIR="/root/sknlp-info-hub-logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/scheduled_discovery_$(date -u +%Y%m%d).log"

cd "$REPO_DIR/ingestion"
source venv/bin/activate
set -a
source "$REPO_DIR/.env.local"
set +a
# .env.local's own DATABASE_URL already points at localhost:5433 (the
# host-accessible port -- see docker-compose.yml's port mapping), so no
# override needed here; it's only the app container itself that gets a
# different (internal-docker-network) value via compose's own
# environment: block.

{
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) scheduled discovery starting ==="
  python3 run_scheduled_discovery.py --max-new 3
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) scheduled discovery finished ==="
} >> "$LOG_FILE" 2>&1
