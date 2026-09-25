#!/usr/bin/env bash
# Sobe tudo o que os testes de ponta a ponta precisam, roda a bateria e
# derruba tudo no fim. Espera um Postgres 16 ouvindo na porta 5433 com
# socket em /tmp.
set -euo pipefail
cd "$(dirname "$0")/.."

PORTA_APP="${PORTA_APP:-3100}"
PORTA_BACKEND="${FAKE_SUPABASE_PORT:-54329}"

limpar() {
  [[ -n "${PID_APP:-}" ]] && kill "$PID_APP" 2>/dev/null || true
  [[ -n "${PID_BACKEND:-}" ]] && kill "$PID_BACKEND" 2>/dev/null || true
}
trap limpar EXIT

echo "→ preparando o banco de teste"
node scripts/e2e-setup.mjs >/dev/null

echo "→ subindo o backend de teste (PostgREST simulado sobre o Postgres real)"
node tests/fake-supabase/server.mjs >/tmp/bp-backend.log 2>&1 &
PID_BACKEND=$!

echo "→ build de produção"
cat > .env.local <<ENV
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:${PORTA_BACKEND}
NEXT_PUBLIC_SUPABASE_ANON_KEY=chave-anon-de-teste
ENV
npm run build >/tmp/bp-build.log 2>&1

echo "→ subindo o app"
npx next start -p "$PORTA_APP" >/tmp/bp-app.log 2>&1 &
PID_APP=$!

for _ in $(seq 1 30); do
  if curl -sf -o /dev/null "http://127.0.0.1:${PORTA_APP}/hoje"; then break; fi
  sleep 1
done

echo "→ rodando a bateria"
npx playwright test "$@"
