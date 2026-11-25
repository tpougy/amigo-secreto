#!/usr/bin/env bash
cd "$(dirname "$0")/../../.." && exec bun --env-file=.env docs/spikes/hairpin/provocar.ts "$@"
