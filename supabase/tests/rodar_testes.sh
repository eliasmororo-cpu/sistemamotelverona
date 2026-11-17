#!/usr/bin/env bash
# Cria o banco descartável motel_teste, aplica as migrations e roda os testes.
set -euo pipefail
cd "$(dirname "$0")/.."
export PGHOST=${PGHOST:-localhost} PGUSER=${PGUSER:-postgres} PGPASSWORD=${PGPASSWORD:-postgres}
dropdb --if-exists motel_teste && createdb motel_teste
psql -X -q -v ON_ERROR_STOP=1 -d motel_teste -f tests/00_stub_supabase.sql
# 0002 usa pg_cron, que só existe no Supabase
for f in migrations/*.sql; do [[ "$f" == *_cron* ]] && continue; psql -X -q -v ON_ERROR_STOP=1 -d motel_teste -f "$f"; done
psql -X -q -v ON_ERROR_STOP=1 -d motel_teste -f tests/testes.sql
echo "Todos os testes passaram."
