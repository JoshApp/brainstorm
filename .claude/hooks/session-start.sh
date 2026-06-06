#!/bin/bash
# SessionStart hook — make the remote Claude Code container's commit
# signing pipeline satisfy the user-level stop-hook.
#
# The stop-hook (~/.claude/stop-hook-git-check.sh) refuses to end the
# turn if any local commit's `git log %G?` resolves to the literal
# "N", or if its committer email isn't noreply@anthropic.com. The
# container starts each session with commit.gpgsign=true and a
# signing program at /tmp/code-sign — but with two gaps that make the
# stop-hook trip:
#
#   1. user.email and user.name are unset, so commits inherit whatever
#      git invents as a default (NOT noreply@anthropic.com).
#   2. No allowed_signers file is configured. The /tmp/code-sign
#      program only supports `-Y sign`, not verify, so even with a
#      file present `%G?` ends up as "B" (bad / unverifiable) — but
#      WITHOUT the file, git short-circuits with
#      "gpg.ssh.allowedSignersFile needs to be configured" and `%G?`
#      collapses to "N". The stop-hook accepts B but rejects N.
#
# Fix:
#   - Set the committer identity.
#   - Extract the signing pubkey from any signed commit reachable on
#     this branch and write it to ~/.ssh/allowed_signers. (The
#     pubkey is embedded in every SSH signature; pulling it out of a
#     real commit avoids hard-coding a value that varies per env.)
#   - Point gpg.ssh.allowedSignersFile at it.
#
# Idempotent. Remote-only — never overwrites Josh's local git config.

set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

git config user.email noreply@anthropic.com
git config user.name Claude

SIGNERS_FILE="$HOME/.ssh/allowed_signers"
mkdir -p "$(dirname "$SIGNERS_FILE")"

# Walk recent commits, pull the embedded pubkey out of the first SSH
# signature we find, write the allowed_signers entry. Silent if no
# signed commit is reachable yet — the very first commit of the run
# will still sign correctly, and the next session will pick the key
# up.
EXTRACTED_PUBKEY=$(python3 - <<'PY' 2>/dev/null || true
import base64, struct, subprocess, sys

def take_string(buf, pos):
    n = struct.unpack('>I', buf[pos:pos+4])[0]
    pos += 4
    return buf[pos:pos+n], pos + n

shas = subprocess.check_output(['git', 'log', '--format=%H', '-50']).decode().split()
for sha in shas:
    obj = subprocess.check_output(['git', 'cat-file', 'commit', sha]).decode()
    in_sig = False
    sig_lines = []
    for line in obj.split('\n'):
        if 'BEGIN SSH SIGNATURE' in line:
            in_sig = True
            continue
        if 'END SSH SIGNATURE' in line:
            break
        if in_sig:
            sig_lines.append(line.strip())
    if not sig_lines:
        continue
    try:
        raw = base64.b64decode(''.join(sig_lines))
    except Exception:
        continue
    if raw[:6] != b'SSHSIG':
        continue
    pos = 6 + 4  # skip magic + version uint32
    pubkey_blob, _ = take_string(raw, pos)
    alg_name, _ = take_string(pubkey_blob, 0)
    print(f"{alg_name.decode()} {base64.b64encode(pubkey_blob).decode()}")
    sys.exit(0)
PY
)

if [ -n "$EXTRACTED_PUBKEY" ]; then
  echo "noreply@anthropic.com $EXTRACTED_PUBKEY" > "$SIGNERS_FILE"
  chmod 600 "$SIGNERS_FILE"
  git config gpg.ssh.allowedSignersFile "$SIGNERS_FILE"
fi

exit 0
