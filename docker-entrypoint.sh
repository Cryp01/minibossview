#!/bin/sh
set -e

# Idempotently ensure the initial superuser exists (only if credentials are set).
if [ -n "$PB_SUPERUSER_EMAIL" ] && [ -n "$PB_SUPERUSER_PASSWORD" ]; then
  /pb/pocketbase superuser upsert "$PB_SUPERUSER_EMAIL" "$PB_SUPERUSER_PASSWORD" \
    --dir=/pb/pb_data --migrationsDir=/pb/pb_migrations || true
fi

# Optional: encrypt PocketBase settings at rest with a 32-char key.
ENC=""
if [ -n "$PB_ENCRYPTION_KEY" ]; then
  ENC="--encryptionEnv=PB_ENCRYPTION_KEY"
fi

exec /pb/pocketbase serve \
  --http=0.0.0.0:8090 \
  --dir=/pb/pb_data \
  --migrationsDir=/pb/pb_migrations \
  --publicDir=/pb/pb_public \
  $ENC
