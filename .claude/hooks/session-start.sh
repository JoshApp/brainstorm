#!/bin/bash
# SessionStart hook — set the git committer identity to the one the
# Claude Code remote container's signing key is registered to.
#
# Without this, commits land with an empty user.email and the
# user-level stop-hook (~/.claude/stop-hook-git-check.sh) refuses to
# end the turn — it greps `git log --format='%h %G? %ce'` for any
# commit whose committer email isn't noreply@anthropic.com and flags
# it as "will show as Unverified on GitHub."
#
# The stop-hook does not care whether the signature verifies LOCALLY
# (it only checks %G? for the literal "N" — bad/unknown sigs pass),
# so we don't need to set up an allowed_signers file. The container
# already sets commit.gpgsign=true and points the signing program at
# /tmp/code-sign, so as long as the identity is right, every commit
# leaves with a signature GitHub will verify.
#
# Remote-only: on Josh's laptop his real git identity must win.

set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

git config user.email noreply@anthropic.com
git config user.name Claude
