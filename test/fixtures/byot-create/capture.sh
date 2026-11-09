#!/usr/bin/env bash
# Captures the aw output `oats aweb setup --create <label> --namespace <domain>`
# depends on, from a real aw binary, offline: a throwaway HOME, no namespace
# controller key, a generated team key for the invite, and an unreachable
# registry and service (127.0.0.1:9) for the calls that need one.
#
# Usage: test/fixtures/byot-create/capture.sh <path-to-aw>
# Writes <name>.stdout, <name>.stderr and <name>.exit beside this script, and
# aw-version.txt and captured-at.txt. The one scrub: the invite token's value in
# invite-team-key.stdout is replaced with SCRUBBED-INVITE-TOKEN.
set -euo pipefail
AW=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
OUT=$(cd "$(dirname "$0")" && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/home/deployment"

awr() { env -i HOME="$WORK/home" PATH=/usr/bin:/bin AWID_REGISTRY_URL=http://127.0.0.1:9 "$AW" "$@"; }
capture() { # capture <name> <cwd> [stdin-file] -- aw args...
  local name=$1 cwd=$2 input=$3; shift 4
  set +e
  (cd "$cwd" && awr "$@" < "$input" > "$OUT/$name.stdout" 2> "$OUT/$name.stderr")
  echo $? > "$OUT/$name.exit"
  set -e
}

"$AW" version > "$OUT/aw-version.txt"
date -u +%Y-%m-%dT%H:%M:%SZ > "$OUT/captured-at.txt"
D="$WORK/home/deployment"

for c in create invite accept-invite register set-server show-server; do
  capture "help-$c" "$D" /dev/null -- id team "$c" --help
done

capture create-no-controller-key "$D" /dev/null -- id team create --name=eng --namespace=example.invalid --json

KEYS="$WORK/home/.awid/team-keys/example.invalid"
mkdir -p "$KEYS"
node -e 'process.stdout.write("-----BEGIN ED25519 PRIVATE KEY-----\n"+require("crypto").randomBytes(32).toString("base64")+"\n-----END ED25519 PRIVATE KEY-----\n")' > "$KEYS/eng.key"
chmod 600 "$KEYS/eng.key"

capture invite-team-key "$D" /dev/null -- id team invite --team=eng --namespace=example.invalid --json
TOKEN_FILE="$WORK/token"
node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).token+"\n")' "$OUT/invite-team-key.stdout" > "$TOKEN_FILE"
ls "$WORK/home/.config/aw/team-invites" > "$OUT/invite-team-key.records"
node -e 'const fs=require("fs"),f=process.argv[1],j=JSON.parse(fs.readFileSync(f,"utf8"));j.token="SCRUBBED-INVITE-TOKEN";fs.writeFileSync(f,JSON.stringify(j)+"\n")' "$OUT/invite-team-key.stdout"
sed -i.bak 's/^.*$/<invite-id>.json/' "$OUT/invite-team-key.records" && rm "$OUT/invite-team-key.records.bak"

capture invite-no-team-key "$D" /dev/null -- id team invite --team=nokey --namespace=example.invalid --json
capture register-unreachable "$D" /dev/null -- id team register --service=http://127.0.0.1:9/api --team=eng:example.invalid --json
capture set-server-unreachable "$D" /dev/null -- id team set-server --team=eng --namespace=example.invalid --url=http://127.0.0.1:9/api --json
capture set-server-no-team-key "$D" /dev/null -- id team set-server --team=nokey --namespace=example.invalid --url=http://127.0.0.1:9/api --json
capture show-server-unreachable "$D" /dev/null -- id team show-server --team=eng --namespace=example.invalid --json

mkdir -p "$D/.aweb-roots/eng"
capture accept-invite-unreachable "$D/.aweb-roots/eng" "$TOKEN_FILE" -- id team accept-invite --token-stdin --name=fixture --local --json
(cd "$D/.aweb-roots/eng" && find . -type f | sort) > "$OUT/accept-invite-unreachable.files"
