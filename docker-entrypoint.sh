#!/bin/sh
set -e

if [ "$1" = "worker" ]; then
  exec node dist/worker.cjs
fi

if [ -n "$DATABASE_URL" ]; then
  node /prisma-cli/node_modules/prisma/build/index.js migrate deploy --schema=/app/prisma/schema.prisma
  node dist/seed.cjs || true
fi

exec node server.js
