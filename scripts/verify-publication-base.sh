#!/usr/bin/env bash
set -euo pipefail

# Never combine fresh artifacts with source that changed after validation.
test "$(git rev-parse HEAD)" = "${PUBLICATION_BASE_SHA:?}"
remote_base=$(git ls-remote --exit-code origin refs/heads/main)
test "$remote_base" = "${PUBLICATION_BASE_SHA}"$'\trefs/heads/main'
# The eventual normal (non-force) push also rejects a race after this check.
