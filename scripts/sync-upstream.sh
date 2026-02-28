#!/usr/bin/env bash
set -euo pipefail

# Sync main with upstream and push to origin.
# Usage: ./scripts/sync-upstream.sh

git fetch upstream

git log --oneline --decorate main..upstream/main

git merge upstream/main

git push origin main
