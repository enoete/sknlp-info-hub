#!/bin/bash
# SKNLP Info Hub — scheduled Postgres backup.
#
# Built 2026-09-01, closing a gap docker-compose.yml itself has flagged
# since day one ("Backups are now your responsibility... Losing this a
# week before launch would be a bad time to discover there was no backup
# strategy") that never actually got acted on. Runs pg_dump INSIDE the
# db container (docker compose exec) rather than a host-installed
# pg_dump, so the dump tool version always exactly matches the server
# version — no separate pg_dump install/version-pinning to maintain.
#
# Output lives at /root/sknlp-backups, deliberately OUTSIDE the git repo
# (/root/sknlp-info-hub) — a Postgres dump has no business being
# version-controlled or accidentally swept up by a broad `git add`.
#
# Retention: keeps the last 14 daily dumps (~2 weeks), deletes older
# ones — enough to recover from "noticed a data problem a few days late"
# without the directory growing unbounded forever on a small droplet.

set -euo pipefail

REPO_DIR="/root/sknlp-info-hub"
BACKUP_DIR="/root/sknlp-backups"
RETENTION_DAYS=14
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT_FILE="$BACKUP_DIR/sknlp_info_hub_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

cd "$REPO_DIR"
docker compose exec -T db pg_dump -U sknlp_app -d sknlp_info_hub | gzip > "$OUT_FILE"

SIZE=$(du -h "$OUT_FILE" | cut -f1)
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) backed up sknlp_info_hub to $OUT_FILE ($SIZE)"

find "$BACKUP_DIR" -name 'sknlp_info_hub_*.sql.gz' -mtime "+${RETENTION_DAYS}" -delete
