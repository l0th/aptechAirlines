#!/usr/bin/env sh
# Export the current MongoDB data (Docker container ars-mongodb) to database/snapshot/airline_db.archive.gz
# Usage: sh database/export-db.sh
set -e
cd "$(dirname "$0")"
mkdir -p snapshot
docker exec ars-mongodb mongodump --db airline_db --archive --gzip > snapshot/airline_db.archive.gz
echo "Exported -> database/snapshot/airline_db.archive.gz"
