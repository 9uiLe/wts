#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test -f flake.lock
test -f bun.lock
bun install --frozen-lockfile --ignore-scripts
mkdir -p release
bun scripts/dependency-inventory.ts > release/DEPENDENCIES.json
bun_status=0
osv_status=0
started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
bun audit --json > release/bun-audit.json 2> release/bun-audit.stderr || bun_status=$?
osv-scanner scan source --lockfile=bun.lock --format=json > release/osv-audit.json 2> release/osv-audit.stderr || osv_status=$?
{
  printf 'queried_at=%s\n' "$started_at"
  printf 'bun_version=%s\n' "$(bun --version)"
  osv-scanner --version
  printf 'bun_database=npm advisory API\nosv_database=https://api.osv.dev\n'
  printf 'database_snapshot=remote APIs; snapshot timestamp not exposed\n'
  printf 'bun_exit_code=%s\nosv_exit_code=%s\n' "$bun_status" "$osv_status"
  printf 'exceptions=none\n'
} > release/AUDIT_INFO
cat release/AUDIT_INFO
test "$bun_status" -eq 0
test "$osv_status" -eq 0
