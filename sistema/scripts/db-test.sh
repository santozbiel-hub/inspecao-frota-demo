#!/usr/bin/env bash
# Roda os testes de banco (lógica de negócio + RLS) num Postgres limpo.
# Uso: scripts/db-test.sh [porta]  — padrão 5433, socket em /tmp
set -euo pipefail
PORT="${1:-5433}"
HOST="${PGHOST:-/tmp}"
USER="${PGUSER:-postgres}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

run() { psql -h "$HOST" -p "$PORT" -U "$USER" -d "$1" -v ON_ERROR_STOP=1 -q -f "$2"; }

for teste in 10_logic_test 20_rls_test; do
  DB="bp_test_${teste%%_*}"
  psql -h "$HOST" -p "$PORT" -U "$USER" -q -c "drop database if exists $DB;" -c "create database $DB;" >/dev/null
  psql -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -q -c "create extension if not exists pgcrypto;" >/dev/null
  run "$DB" "$ROOT/supabase/tests/00_auth_stub.sql"                              >/dev/null 2>&1
  for m in "$ROOT"/supabase/migrations/*.sql; do
    # schemas gerenciados pelo Supabase, e carga inicial (dado, não schema)
    case "$m" in *storage_and_auth*|*dados_iniciais*) continue;; esac
    run "$DB" "$m" >/dev/null 2>&1
  done
  psql -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/${teste}.sql" \
    | grep -vE '^(SET|DO|CREATE|INSERT|UPDATE|DELETE|\s*$|\s*check\s*$|-+$|\(1 row\))'
done
