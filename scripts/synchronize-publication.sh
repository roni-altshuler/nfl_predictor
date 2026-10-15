#!/usr/bin/env bash
set -euo pipefail

# Synchronize while the checkout is clean, before deriving artifacts or QA.
# A divergent dispatch branch or conflicting work must stop rather than reset.
git diff --quiet
git diff --cached --quiet
git fetch --no-tags origin main
git merge --ff-only FETCH_HEAD
publication_base=$(git rev-parse FETCH_HEAD)
test "$(git rev-parse HEAD)" = "$publication_base"
printf 'PUBLICATION_BASE_SHA=%s\n' "$publication_base" >> "${GITHUB_ENV:?}"
