#!/usr/bin/env bash
# Runs the VPS e2e (webhook mode). Needs IC_TEST_* in the root env file and the Dokku app ic-teste-worker up.
set -euo pipefail
cd "$(dirname "$0")/../.."
IC_E2E=1 exec bun --env-file=../../.env test testes/e2e
