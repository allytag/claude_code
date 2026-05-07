#!/bin/zsh
set -euo pipefail
cd "$(dirname "$0")"
node scripts/redact-check.mjs
node scripts/doctor-local.mjs
