#!/usr/bin/env bash
# fb-backup.sh — nightly LOCAL backup of the Hetzner box's irreplaceable data.
# Lives at /usr/local/bin/fb-backup.sh on the box; run by root cron (install note at bottom).
#
# Backs up the two stores that are NOT mirrored to Supabase / would die with the box:
#   - Rocket.Chat Mongo  (team chat history + uploads, ~233 MB)
#   - box Postgres       (db "footagebrain", user "fb")
# Keeps the 7 newest of each, gzipped, in /srv/backups.
#
# SCOPE: LOCAL backup (same disk) — protects against accidental drop / container loss /
# corruption, NOT total box loss. Offsite (S3/R2 or a Hetzner volume snapshot) is a follow-up
# that needs a bucket + creds.
set -euo pipefail

DEST=/srv/backups
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST"

# Mongo: --archive streams the dump to stdout; uses the container's own localhost connection.
docker exec fb-mongodb sh -c 'mongodump --archive --gzip' > "$DEST/mongo-$STAMP.archive.gz"

# Postgres: dump via the container's own env (POSTGRES_USER / POSTGRES_DB), local socket-trust auth.
docker exec fb-postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' \
  | gzip > "$DEST/pg-$STAMP.sql.gz"

# Retention: keep the 7 newest of each kind.
ls -1t "$DEST"/mongo-*.archive.gz 2>/dev/null | tail -n +8 | xargs -r rm -f
ls -1t "$DEST"/pg-*.sql.gz        2>/dev/null | tail -n +8 | xargs -r rm -f

echo "[$(date -u +%FT%TZ)] backup ok:"
ls -lh "$DEST/mongo-$STAMP.archive.gz" "$DEST/pg-$STAMP.sql.gz"

# ── install (run once, human-gated) ──────────────────────────────────────────
#   chmod +x /usr/local/bin/fb-backup.sh
#   ( crontab -l 2>/dev/null; echo '15 3 * * * /usr/local/bin/fb-backup.sh >> /var/log/fb-backup.log 2>&1' ) | crontab -
#   /usr/local/bin/fb-backup.sh        # verify it writes non-empty dumps
#
# restore (reference):
#   gunzip -c mongo-<stamp>.archive.gz | docker exec -i fb-mongodb mongorestore --archive --gzip --drop
#   gunzip -c pg-<stamp>.sql.gz | docker exec -i fb-postgres psql -U fb -d footagebrain
