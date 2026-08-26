#!/bin/sh
set -e

if [ "$1" = "worker" ]; then
  exec npx tsx worker/index.ts
fi

if [ -n "$DATABASE_URL" ]; then
  npx prisma migrate deploy
  npx tsx prisma/seed.ts || true
fi

exec node server.js
