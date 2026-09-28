#!/usr/bin/env bash
# Run all headless unit tests (no browser needed).
set -euo pipefail
cd "$(dirname "$0")"
exec node --test test/
