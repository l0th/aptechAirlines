#!/usr/bin/env sh
# Restore database/snapshot/airline_db.archive.gz into the Docker MongoDB (ars-mongodb).
# WARNING: --drop replaces existing collections in airline_db.
# Usage: docker compose up -d && sh database/import-db.sh
set -e
cd "$(dirname "$0")"
docker exec -i ars-mongodb mongorestore --archive --gzip --drop --nsInclude 'airline_db.*' < snapshot/airline_db.archive.gz
echo "Imported snapshot into airline_db. Restart backend: docker compose restart backend"
