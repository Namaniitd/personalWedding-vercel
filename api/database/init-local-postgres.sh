#!/bin/sh
# The official Postgres image runs this only when its data directory is empty.
# Keep schema initialization atomic: an error cannot commit a partial schema.
# Subsequent upgrades, or recovery after a failed first initialization, use
# `pnpm db:apply` against the running local database.
set -eu

psql \
  --set ON_ERROR_STOP=on \
  --single-transaction \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --file /usr/local/share/shaadi/schema.sql
