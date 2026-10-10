#!/bin/bash
# Captures, verbatim, the aw output `oats aweb resident create` reads, from a
# real aw against aweb's local stack (docker-compose.e2e.yml: postgres, redis,
# awid, aweb). Usage, with the stack up on its default ports:
#
#   test/fixtures/resident/capture.sh <aw binary> <scratch dir>
#
# It writes into this directory. Refresh the fixtures with it whenever aw's
# output contract changes, and update README.md (aw version, commit, date).
set -u
AW="$1"; S="$2"
OUT="$(cd "$(dirname "$0")" && pwd)"
AWEB_URL="${AWEB_URL:-http://127.0.0.1:18000}"
AWID="${AWID_REGISTRY_URL:-http://127.0.0.1:18010}"
rm -rf "$S"; mkdir -p "$S/home" "$S/partial" "$S/complete"
a() { env -i PATH="$(dirname "$AW"):/usr/bin:/bin" HOME="$S/home" AWEB_URL="$AWEB_URL" AWID_REGISTRY_URL="$AWID" AW_NO_UPDATE_CHECK=1 NO_COLOR=1 "$AW" "$@"; }
capture() { # name dir args...
  local name="$1" dir="$2"; shift 2
  (cd "$dir" && a "$@" > "$OUT/$name.stdout" 2> "$OUT/$name.stderr"; echo $? > "$OUT/$name.exit")
}
"$AW" version > "$OUT/aw-version.txt"

# API-key init: aw saves .aw/partial-init.yaml, registers the DID at awid, then
# posts to /api/v1/workspaces/init, which the OSS aweb server does not serve.
KEY="aw_sk_fixture_not_a_real_key"
(cd "$S/partial" && env -i PATH="$(dirname "$AW"):/usr/bin:/bin" HOME="$S/home" AWEB_URL="$AWEB_URL" AWID_REGISTRY_URL="$AWID" AWEB_API_KEY="$KEY" AW_NO_UPDATE_CHECK=1 NO_COLOR=1 "$AW" init --global --name alice --do-not-touch-agents-md --json > "$OUT/init-apikey-workspace-init-404.stdout" 2> "$OUT/init-apikey-workspace-init-404.stderr"; echo $? > "$OUT/init-apikey-workspace-init-404.exit")
# The same partial, resumed with another registry: aw's context check refuses.
(cd "$S/partial" && env -i PATH="$(dirname "$AW"):/usr/bin:/bin" HOME="$S/home" AWEB_URL="$AWEB_URL" AWID_REGISTRY_URL="http://localhost:${AWID##*:}" AWEB_API_KEY="$KEY" AW_NO_UPDATE_CHECK=1 NO_COLOR=1 "$AW" init --global --name alice --do-not-touch-agents-md --json > "$OUT/init-apikey-registry-mismatch.stdout" 2> "$OUT/init-apikey-registry-mismatch.stderr"; echo $? > "$OUT/init-apikey-registry-mismatch.exit")
# A partial alone is not an identity: every offline identity check is info.
capture doctor-identity-offline-partial "$S/partial" doctor identity --offline --json
# A quarantined partial: the file is named the way aw names one (only aweb
# Cloud makes aw quarantine), and aw's refusal of it is real.
mkdir -p "$S/rejected/.aw" && chmod 700 "$S/rejected/.aw"
: > "$S/rejected/.aw/partial-init.yaml.20261010T000000.000000000Z.1.rejected" && chmod 600 "$S/rejected/.aw/"*.rejected
(cd "$S/rejected" && env -i PATH="$(dirname "$AW"):/usr/bin:/bin" HOME="$S/home" AWEB_URL="$AWEB_URL" AWID_REGISTRY_URL="$AWID" AWEB_API_KEY="$KEY" AW_NO_UPDATE_CHECK=1 NO_COLOR=1 "$AW" init --global --name alice --do-not-touch-agents-md --json > "$OUT/init-apikey-rejected.stdout" 2> "$OUT/init-apikey-rejected.stderr"; echo $? > "$OUT/init-apikey-rejected.exit")
# An init that fails before it writes anything: AWID_REGISTRY_URL=local.
mkdir -p "$S/empty"
(cd "$S/empty" && env -i PATH="$(dirname "$AW"):/usr/bin:/bin" HOME="$S/home" AWEB_URL="$AWEB_URL" AWID_REGISTRY_URL=local AWEB_API_KEY="$KEY" AW_NO_UPDATE_CHECK=1 NO_COLOR=1 "$AW" init --global --name alice --do-not-touch-agents-md --json > "$OUT/init-apikey-registry-local.stdout" 2> "$OUT/init-apikey-registry-local.stderr"; echo $? > "$OUT/init-apikey-registry-local.exit"; find . -mindepth 1 | sort > "$S/empty.left")
# A malformed AWEB_URL: aw saves the partial and registers before it fails.
mkdir -p "$S/nothing"
(cd "$S/nothing" && env -i PATH="$(dirname "$AW"):/usr/bin:/bin" HOME="$S/home" AWEB_URL="not a url" AWID_REGISTRY_URL="$AWID" AWEB_API_KEY="$KEY" AW_NO_UPDATE_CHECK=1 NO_COLOR=1 "$AW" init --global --name alice --do-not-touch-agents-md --json > "$OUT/init-apikey-bad-url.stdout" 2> "$OUT/init-apikey-bad-url.stderr"; echo $? > "$OUT/init-apikey-bad-url.exit"; find . -mindepth 1 | sort > "$S/nothing.left")

# A complete global identity, made as aweb's own real-stack e2e makes one
# (cli/go/e2e/real_stack_e2e_test.go), then connected with aw's
# certificate init: the same connectOutput JSON the API-key init prints.
NS="fixture-$RANDOM.test"
(cd "$S/complete" && env -i PATH="$(dirname "$AW"):/usr/bin:/bin" HOME="$S/home" AWEB_URL="$AWEB_URL" AWID_REGISTRY_URL="$AWID" AWID_SKIP_DNS_VERIFY=1 AW_NO_UPDATE_CHECK=1 NO_COLOR=1 sh -c '
  "$0" id create --domain "$1" --name carol --registry "$2" --skip-dns-verify --json >/dev/null 2>&1 &&
  "$0" id team create --namespace "$1" --name default --registry "$2" --json >/dev/null &&
  cid=$("$0" id team add-member --namespace "$1" --team default --member "$1/carol" --json | sed -n "s/.*\"certificate_id\": \"\([^\"]*\)\".*/\1/p") &&
  "$0" id team fetch-cert --namespace "$1" --team default --cert-id "$cid" --registry "$2" --json >/dev/null' "$AW" "$NS" "$AWID") || { echo "global identity setup failed" >&2; exit 1; }
capture init-certificate-connect "$S/complete" init --do-not-touch-agents-md --json
capture whoami "$S/complete" whoami --json
capture doctor-identity-offline "$S/complete" doctor identity --offline --json
capture doctor-registry-online "$S/complete" doctor registry --online --json
capture custody-status-not-running "$S/complete" custody status --json
(cd "$S/complete" && a custody serve > "$S/serve.log" 2>&1 &)
for _ in $(seq 1 30); do
  (cd "$S/complete" && a custody status --json) | grep -q '"status": "running"' && break
  sleep 1
done
capture custody-status-running "$S/complete" custody status --json
(cd "$S/complete" && a custody stop)
date -u +%Y-%m-%dT%H:%M:%SZ > "$OUT/captured-at.txt"
