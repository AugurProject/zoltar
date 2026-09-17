#!/usr/bin/env bash
set -euo pipefail

phase="${1:?Expected a worktree check phase}"
echo "Verifying ${phase} worktree cleanliness"
git diff --exit-code -- .
status="$(git status --porcelain --untracked-files=normal)"
if [[ -n "$status" ]]; then
  echo "Unexpected ${phase} worktree changes:"
  echo "$status"
  exit 1
fi
git diff --check
