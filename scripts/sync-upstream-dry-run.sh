#!/usr/bin/env bash
set -euo pipefail

# Dry-run sync: fetch upstream and show what would change.
# Usage: ./scripts/sync-upstream-dry-run.sh

git fetch upstream

echo "\nCommits on upstream/main not in main:"
git log --oneline --decorate main..upstream/main

echo "\nDiff summary (main..upstream/main):"
git diff --stat main..upstream/main
