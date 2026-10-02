# oats.aweb delivery switch: end-to-end receipt

**Result: PASS**

- Date: 2026-10-02T16:03:07.118Z (UTC)
- aw: `aw 1.36.23 commit: 61c38162596d1af9085741d70d15900ff9894257 (github.com/awebai/aw)` (/opt/homebrew/bin/aw); daemon reported 1.36.23 commit 61c38162596d1af9085741d70d15900ff9894257
- aweb-oss: `f22257f30d5ebfc9b6b8dfa4840b87e9e97467d7 fix(wake): refuse terminal input while harness reports blocked` (origin/main of /Users/juanre/awebai/aweb/aweb-oss, cloned into the temp dir; compose ran only there)
- oats-aweb hook: work HEAD 9c4ffb35020e65b5f513c3b572f2fac81a105282; bin/oats-aweb.mjs sha256 b9e036f22a1d66977bde1e4774cb0dc1dac23164d3f29349ea2c0f1fe9b24816
- node v26.8.2; compose project `e2eds-mur5jw7i`; local stack aweb http://127.0.0.1:55032, awid http://127.0.0.1:55033; team `devteam:e2eds-1790957029905.test`
- Instance home: `$TMP/ws/agents/dev/instances/dev-1` (`$TMP` = one fresh temp dir, removed at the end); HOME, AW_CONFIG_PATH and AW_WAKE_STATE_DIR of every aw/node process were inside it
- Docker Desktop was not running; the harness started it and quit it

## Checks

- [x] temp clone is at the source's origin/main — f22257f30d5ebfc9b6b8dfa4840b87e9e97467d7 fix(wake): refuse terminal input while harness reports blocked
- [x] our broker's state dir is the temp one — $TMP/wake
- [x] s1: codex spawn exits 0
- [x] s1: codex spawn sets AWEB_DELIVERY=session and no channel flag
- [x] s1: broker lists the codex home before the switch
- [x] s1: claude launch exits 0
- [x] s1: claude launch returns the channel flag and no AWEB_DELIVERY
- [x] s1: broker no longer lists the home after the claude launch
- [x] s2: broker does not list the home before the codex launch
- [x] s2: codex launch exits 0
- [x] s2: codex launch sets AWEB_DELIVERY=session and no channel flag
- [x] s2: broker lists the home after the codex launch
- [x] s3: broker lists the home before the codex relaunch
- [x] s3: codex relaunch exits 0
- [x] s3: codex relaunch sets AWEB_DELIVERY=session and no channel flag
- [x] s3: broker still lists the home after the codex relaunch
- [x] 1: every mail presented exactly once — 24 mails
- [x] 2: every mail presented exactly once — 20 mails
- [x] 3: every mail presented exactly once — 12 mails
- [x] s1: the stream was split: the broker presented the early mails, the channel the later ones — broker 7, channel 17
- [x] s2: the stream was split: the channel presented the early mails, the broker the later ones — channel 2, broker 18
- [x] s3: the broker presented every mail across the codex relaunch — broker 12, channel 0
- [x] no presentation of an unknown or id-less event
- [x] s1: the broker presented nothing between the claude launch and the codex relaunch
- [x] s2: the channel presented nothing after the claude session ended

## Duplicates and losses

- No message id was presented more than once.
- No sent message id went unpresented.

## Scenario 1. codex home on the broker switches to the Claude channel mid-stream

Spawn hook (OATS_RUNTIME=codex): `{"exit":0,"env_AWEB_DELIVERY":"session","launch_claude":null,"meta_runtime":"codex","meta_delivery":"channel"}`

Launch hook: `{"exit":0,"env_AWEB_DELIVERY":null,"launch_claude":"--dangerously-load-development-channels plugin:aweb-channel@awebai-marketplace","meta_runtime":"claude","meta_delivery":"channel"}` (finished 2026-10-02T16:03:54.794Z)

Channel plugin started 2026-10-02T16:03:54.815Z, right after the launch hook succeeded.

`aw wake status --json` (trimmed), before spawn:

```json
{
  "daemon_running": true,
  "daemon_version": "1.36.23",
  "instances": []
}
```

`aw wake status --json` (trimmed), after codex spawn, before the switch:

```json
{
  "daemon_running": true,
  "daemon_version": "1.36.23",
  "instances": [
    {
      "home": "$TMP/ws/agents/dev/instances/dev-1",
      "delivery": "session",
      "runtime_delivery": "external-session",
      "phase": "pending",
      "registered_at": "2026-10-02T16:03:50.965063Z",
      "receive_identities": [
        {
          "identity_home": "$TMP/ws/agents/dev/instances/dev-1/.aw",
          "stream_phase": "streaming",
          "stream_admitted": true
        }
      ]
    }
  ]
}
```

`aw wake status --json` (trimmed), after the claude launch hook:

```json
{
  "daemon_running": true,
  "daemon_version": "1.36.23",
  "instances": []
}
```

`aw wake status --json` (trimmed), end of scenario 1:

```json
{
  "daemon_running": true,
  "daemon_version": "1.36.23",
  "instances": []
}
```

Per-message presentations (sent at a steady rate; the switch ran while mail kept arriving):

| seq | message_id | sent at | presented at (by) | broker | channel | total |
|---|---|---|---|---|---|---|
| 1 | 1f4ba915-1f1f-4d44-8d3d-74943d4e498d | 16:03:51.120 | 16:03:52.155 (broker) | 1 | 0 | 1 |
| 2 | 4a79d6c6-5c55-4e88-8ba4-eb4c1f8f8a8d | 16:03:51.574 | 16:03:52.299 (broker) | 1 | 0 | 1 |
| 3 | 63307f79-09da-4cd3-a082-e8025f745ebe | 16:03:52.036 | 16:03:53.099 (broker) | 1 | 0 | 1 |
| 4 | f0350b06-91fe-4ecb-9110-172403ed6c0c | 16:03:52.496 | 16:03:53.208 (broker) | 1 | 0 | 1 |
| 5 | 9f4947db-2ee1-4874-8858-fd7c9bb9b70f | 16:03:52.946 | 16:03:53.312 (broker) | 1 | 0 | 1 |
| 6 | 7c884ddb-2afe-46f6-8299-591bf7de7b07 | 16:03:53.393 | 16:03:54.108 (broker) | 1 | 0 | 1 |
| 7 | c936836a-9d4d-4814-845e-703368f8758f | 16:03:53.845 | 16:03:54.213 (broker) | 1 | 0 | 1 |
| 8 | 8271b2fc-833e-4c04-84a8-40cdbf749150 | 16:03:54.295 | 16:03:54.993 (channel) | 0 | 1 | 1 |
| 9 | 32f74089-799f-45cb-8ed0-af40ccca481b | 16:03:54.752 | 16:03:55.019 (channel) | 0 | 1 | 1 |
| 10 | c0346253-0a36-48f2-8bb1-655e825d27c4 | 16:03:55.210 | 16:03:55.980 (channel) | 0 | 1 | 1 |
| 11 | 79b0b6c0-b32f-4803-98a5-62f94dd0caaf | 16:03:55.662 | 16:03:56.004 (channel) | 0 | 1 | 1 |
| 12 | c81dd30b-2dcd-4b08-980c-f6fef5fb726e | 16:03:56.111 | 16:03:56.994 (channel) | 0 | 1 | 1 |
| 13 | d21c0acd-9ebc-4cf2-89a3-8737f47682c1 | 16:03:56.569 | 16:03:57.026 (channel) | 0 | 1 | 1 |
| 14 | e5faad9e-dbf4-4afe-9985-3e30e4a67f2c | 16:03:57.021 | 16:03:58.000 (channel) | 0 | 1 | 1 |
| 15 | 1463f09b-7697-4dac-a0ee-6ea957c9c0b4 | 16:03:57.470 | 16:03:58.027 (channel) | 0 | 1 | 1 |
| 16 | 71a7a643-f17c-4ecd-b44b-c70c3b684a7a | 16:03:57.928 | 16:03:58.053 (channel) | 0 | 1 | 1 |
| 17 | 0eacffd5-f686-423e-93cc-55d96243ba94 | 16:03:58.398 | 16:03:59.016 (channel) | 0 | 1 | 1 |
| 18 | a0ed12f4-e82a-41e0-a17b-e9af5e00812f | 16:03:58.855 | 16:03:59.046 (channel) | 0 | 1 | 1 |
| 19 | 70460bcd-5ac9-4010-a507-bcd43033b87c | 16:03:59.312 | 16:04:00.024 (channel) | 0 | 1 | 1 |
| 20 | 76bee048-f143-4460-ac7f-9abdfc626f08 | 16:03:59.766 | 16:04:00.050 (channel) | 0 | 1 | 1 |
| 21 | 2c9ca04f-f1ef-4a5c-b2ad-7dd4944182e2 | 16:04:00.218 | 16:04:01.035 (channel) | 0 | 1 | 1 |
| 22 | a906c04d-417d-481e-9704-6e391c229bea | 16:04:00.677 | 16:04:01.060 (channel) | 0 | 1 | 1 |
| 23 | bed1a6c4-956a-4e95-9f9b-63811c78a2f2 | 16:04:01.145 | 16:04:02.046 (channel) | 0 | 1 | 1 |
| 24 | adc35157-322d-4ff8-80b1-ea666dae6fe2 | 16:04:01.603 | 16:04:02.082 (channel) | 0 | 1 | 1 |

Totals: 24 mails sent, 7 broker presentations, 17 channel presentations.

## Scenario 2. claude home relaunched as codex is registered with the broker

Ending the Claude session: channel plugin: exited (code 0) 6 ms after stdin close + SIGTERM

Launch hook: `{"exit":0,"env_AWEB_DELIVERY":"session","launch_claude":null,"meta_runtime":"codex","meta_delivery":"channel"}` (finished 2026-10-02T16:04:13.728Z)

`aw wake status --json` (trimmed), claude session ended, before the codex launch hook:

```json
{
  "daemon_running": true,
  "daemon_version": "1.36.23",
  "instances": []
}
```

`aw wake status --json` (trimmed), after the codex launch hook:

```json
{
  "daemon_running": true,
  "daemon_version": "1.36.23",
  "instances": [
    {
      "home": "$TMP/ws/agents/dev/instances/dev-1",
      "delivery": "session",
      "runtime_delivery": "external-session",
      "phase": "pending",
      "registered_at": "2026-10-02T16:04:13.710105Z",
      "receive_identities": [
        {
          "identity_home": "$TMP/ws/agents/dev/instances/dev-1/.aw",
          "stream_phase": "streaming",
          "stream_admitted": true
        }
      ]
    }
  ]
}
```

Per-message presentations (sent at a steady rate; the switch ran while mail kept arriving):

| seq | message_id | sent at | presented at (by) | broker | channel | total |
|---|---|---|---|---|---|---|
| 101 | 31c91701-d73f-4965-971a-86046593be85 | 16:04:12.325 | 16:04:13.120 (channel) | 0 | 1 | 1 |
| 102 | 2254ecf4-e9c5-4ca9-976e-ad293697335e | 16:04:12.772 | 16:04:13.161 (channel) | 0 | 1 | 1 |
| 103 | 45f696ff-90ab-452f-baf2-b764aa024200 | 16:04:13.225 | 16:04:13.979 (broker) | 1 | 0 | 1 |
| 104 | 968b29e8-838c-4f14-8ce5-525b8f7c7834 | 16:04:13.681 | 16:04:14.084 (broker) | 1 | 0 | 1 |
| 105 | 16aaa8be-2b67-4c4d-a23a-31916817b5ed | 16:04:14.134 | 16:04:14.844 (broker) | 1 | 0 | 1 |
| 106 | d5fafe2c-740a-48f6-b95d-f1a414af32b9 | 16:04:14.578 | 16:04:14.982 (broker) | 1 | 0 | 1 |
| 107 | e430e082-b178-4b3c-a8b7-0d4ef36ed2fc | 16:04:15.031 | 16:04:15.832 (broker) | 1 | 0 | 1 |
| 108 | 21a1729c-c948-4048-8c94-271716718af2 | 16:04:15.480 | 16:04:15.943 (broker) | 1 | 0 | 1 |
| 109 | 15b59aae-1a18-4988-a5f5-512f350e42b9 | 16:04:15.933 | 16:04:16.842 (broker) | 1 | 0 | 1 |
| 110 | 570761dd-30f1-446c-912f-9b5dad0bd56e | 16:04:16.395 | 16:04:16.941 (broker) | 1 | 0 | 1 |
| 111 | 75d37b11-b6fa-4eed-a720-a866e9aa884f | 16:04:16.843 | 16:04:17.839 (broker) | 1 | 0 | 1 |
| 112 | a447e384-8735-4ea5-b271-d604f177f65f | 16:04:17.311 | 16:04:17.949 (broker) | 1 | 0 | 1 |
| 113 | a5361c04-3d6a-4400-9a54-aaf2da61b643 | 16:04:17.757 | 16:04:18.080 (broker) | 1 | 0 | 1 |
| 114 | ff4d38a0-ace0-4ab1-86a2-469ae3e4782b | 16:04:18.202 | 16:04:18.851 (broker) | 1 | 0 | 1 |
| 115 | 895c4d12-7ea7-4c7b-8f97-4cd56c327588 | 16:04:18.671 | 16:04:18.975 (broker) | 1 | 0 | 1 |
| 116 | 29572e3c-ca0e-4171-9655-9e4540e438bc | 16:04:19.122 | 16:04:19.884 (broker) | 1 | 0 | 1 |
| 117 | 77bad3bc-b3db-44fa-826b-56fa298a60a7 | 16:04:19.571 | 16:04:20.013 (broker) | 1 | 0 | 1 |
| 118 | 97ed18c2-c56f-4bc6-a288-4807f4bb20ee | 16:04:20.017 | 16:04:20.867 (broker) | 1 | 0 | 1 |
| 119 | 26dce32f-a546-4511-ab1d-f1171c7ad78b | 16:04:20.468 | 16:04:20.970 (broker) | 1 | 0 | 1 |
| 120 | a14f367a-ecc5-42b9-8659-5305b30c721f | 16:04:20.915 | 16:04:21.879 (broker) | 1 | 0 | 1 |

Totals: 20 mails sent, 18 broker presentations, 2 channel presentations.

## Scenario 3. codex home relaunched as codex keeps its broker registration

Launch hook: `{"exit":0,"env_AWEB_DELIVERY":"session","launch_claude":null,"meta_runtime":"codex","meta_delivery":"channel"}` (finished 2026-10-02T16:04:33.554Z)

`aw wake status --json` (trimmed), before the codex relaunch hook:

```json
{
  "daemon_running": true,
  "daemon_version": "1.36.23",
  "instances": [
    {
      "home": "$TMP/ws/agents/dev/instances/dev-1",
      "delivery": "session",
      "runtime_delivery": "external-session",
      "phase": "active",
      "registered_at": "2026-10-02T16:04:13.710105Z",
      "receive_identities": [
        {
          "identity_home": "$TMP/ws/agents/dev/instances/dev-1/.aw",
          "stream_phase": "streaming",
          "stream_admitted": true
        }
      ]
    }
  ]
}
```

`aw wake status --json` (trimmed), after the codex relaunch hook:

```json
{
  "daemon_running": true,
  "daemon_version": "1.36.23",
  "instances": [
    {
      "home": "$TMP/ws/agents/dev/instances/dev-1",
      "delivery": "session",
      "runtime_delivery": "external-session",
      "phase": "active",
      "registered_at": "2026-10-02T16:04:13.710105Z",
      "receive_identities": [
        {
          "identity_home": "$TMP/ws/agents/dev/instances/dev-1/.aw",
          "stream_phase": "streaming",
          "stream_admitted": true
        }
      ]
    }
  ]
}
```

Per-message presentations (sent at a steady rate; the switch ran while mail kept arriving):

| seq | message_id | sent at | presented at (by) | broker | channel | total |
|---|---|---|---|---|---|---|
| 201 | 49bde5e3-dc80-4dd9-ac17-74d403992cf6 | 16:04:32.117 | 16:04:32.979 (broker) | 1 | 0 | 1 |
| 202 | 40ad6bf3-8362-4811-a0d6-ab25a89dcdef | 16:04:32.566 | 16:04:33.126 (broker) | 1 | 0 | 1 |
| 203 | 093ad228-b400-475c-b2af-7c4a1b8e0327 | 16:04:33.064 | 16:04:33.964 (broker) | 1 | 0 | 1 |
| 204 | d1c7bf4d-d14d-4441-b82a-3c88cd5046c5 | 16:04:33.512 | 16:04:34.059 (broker) | 1 | 0 | 1 |
| 205 | d315be08-e0e3-4ffd-808b-d9b777730992 | 16:04:33.950 | 16:04:34.969 (broker) | 1 | 0 | 1 |
| 206 | 7272e377-d9d3-4fee-8bce-76e6486f29f0 | 16:04:34.392 | 16:04:35.055 (broker) | 1 | 0 | 1 |
| 207 | 245777e6-2906-4ac2-97d1-6e1aaa67df97 | 16:04:34.828 | 16:04:35.146 (broker) | 1 | 0 | 1 |
| 208 | d15c2bc9-9cad-44f5-9ca5-6c7bb0390fa8 | 16:04:35.268 | 16:04:35.974 (broker) | 1 | 0 | 1 |
| 209 | 28a4db8e-0ffa-4601-9e20-76471ddaeadd | 16:04:35.707 | 16:04:36.065 (broker) | 1 | 0 | 1 |
| 210 | 1cee19c7-074c-464d-812b-c4eb8120a1b5 | 16:04:36.149 | 16:04:36.982 (broker) | 1 | 0 | 1 |
| 211 | 54e74bb4-9393-4c6c-9f53-a243612d7111 | 16:04:36.587 | 16:04:37.071 (broker) | 1 | 0 | 1 |
| 212 | 6d90ea00-2fcf-4de4-930d-7d76fad5c1ac | 16:04:37.019 | 16:04:37.995 (broker) | 1 | 0 | 1 |

Totals: 12 mails sent, 12 broker presentations, 0 channel presentations.

## Channel plugin stderr

0 lines; 0 mention error/fatal/warn/fail.

## Commands run (in order)

```
git -C <src> rev-parse origin/main
git clone --quiet <src> $TMP/aweb-oss
git -C $TMP/aweb-oss fetch --quiet <src> +refs/remotes/origin/main:refs/remotes/src/main
git -C $TMP/aweb-oss checkout --quiet --detach f22257f30d5ebfc9b6b8dfa4840b87e9e97467d7
git -C $TMP/aweb-oss log -1
docker info
open -a Docker
(cd $TMP/aweb-oss/server) docker compose -p e2eds-mur5jw7i -f $TMP/aweb-oss/server/docker-compose.yml --env-file $TMP/stack.env up -d --build awid aweb
(cd $TMP/aweb-oss/channel) npm ci
(cd $TMP/aweb-oss/channel) npm run build
(cd $TMP/alice) aw --json id create --name alice --domain e2eds-1790957029905.test --registry http://127.0.0.1:55033 --skip-dns-verify
(cd $TMP/alice) aw --json id team create --namespace e2eds-1790957029905.test --name devteam --registry http://127.0.0.1:55033
(cd $TMP/alice) aw --json id team invite --namespace e2eds-1790957029905.test --team devteam
(cd $TMP/alice) aw --json id team accept-invite <invite-token> --global --name alice
(cd $TMP/alice) aw --json init --url http://127.0.0.1:55032
(cd $TMP/alice) aw --json id encryption-key setup
AW_WAKE_OATS_BIN=$TMP/bin/oats aw wake run --state-dir $TMP/wake   # foreground daemon; fake oats appends each presented input to $TMP/broker-presented.jsonl
(cd $TMP) aw wake status --json   # x2
(cd $TMP/ws/agents/dev/instances/dev-1) OATS_EVENT=spawn OATS_RUNTIME=codex OATS_SETTINGS='{"root":"$TMP/alice","delivery":"channel"}' node oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs spawn
(cd $TMP) aw wake status --json
(cd $TMP/alice) aw --json mail send --to dev-1 --body 'E2E-SEQ-<n> phase1'   # x8
(cd $TMP/ws/agents/dev/instances/dev-1) OATS_EVENT=launch OATS_RUNTIME=claude OATS_PREVIOUS_RUNTIME=codex OATS_META=<meta> OATS_SETTINGS='{"root":"$TMP/alice","delivery":"channel"}' node oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs launch
(cd $TMP/alice) aw --json mail send --to dev-1 --body 'E2E-SEQ-<n> phase1'
(cd $TMP) aw wake status --json
(cwd $TMP/ws/agents/dev/instances/dev-1) AWEB_IDENTITY_HOME=$TMP/ws/agents/dev/instances/dev-1/.aw AW_BIN=/opt/homebrew/bin/aw node $TMP/aweb-oss/channel/dist/index.js  # MCP stdio client: initialize, notifications/initialized, collect notifications/claude/channel
(cd $TMP/alice) aw --json mail send --to dev-1 --body 'E2E-SEQ-<n> phase1'   # x15
(cd $TMP) aw wake status --json
(cd $TMP/alice) aw --json mail send --to dev-1 --body 'E2E-SEQ-<n> phase2'   # x4
(cd $TMP) aw wake status --json
(cd $TMP/ws/agents/dev/instances/dev-1) OATS_EVENT=launch OATS_RUNTIME=codex OATS_PREVIOUS_RUNTIME=claude OATS_META=<meta> OATS_SETTINGS='{"root":"$TMP/alice","delivery":"channel"}' node oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs launch
(cd $TMP) aw wake status --json
(cd $TMP/alice) aw --json mail send --to dev-1 --body 'E2E-SEQ-<n> phase2'   # x16
(cd $TMP/alice) aw --json mail send --to dev-1 --body 'E2E-SEQ-<n> phase3'   # x3
(cd $TMP) aw wake status --json
(cd $TMP/alice) aw --json mail send --to dev-1 --body 'E2E-SEQ-<n> phase3'
(cd $TMP/ws/agents/dev/instances/dev-1) OATS_EVENT=launch OATS_RUNTIME=codex OATS_PREVIOUS_RUNTIME=codex OATS_META=<meta> OATS_SETTINGS='{"root":"$TMP/alice","delivery":"channel"}' node oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs launch
(cd $TMP) aw wake status --json
(cd $TMP/alice) aw --json mail send --to dev-1 --body 'E2E-SEQ-<n> phase3'   # x8
(cd $TMP/aweb-oss/server) docker compose -p e2eds-mur5jw7i ... down -v --rmi local --remove-orphans
docker ps -a --filter label=com.docker.compose.project=e2eds-mur5jw7i -q
docker volume ls --filter label=com.docker.compose.project=e2eds-mur5jw7i -q
docker network ls --filter label=com.docker.compose.project=e2eds-mur5jw7i -q
docker volume ls -q
osascript -e 'quit app "Docker"'
docker desktop stop
```

## Cleanup

- [x] stop the channel plugin: not running (stopped in scenario 2)
- [x] stop our `aw wake run` daemon: aw wake run: exited (code 0) 19 ms after SIGTERM
- [x] no harness process left (pgrep -f $TMP: broker, channel-core runner, plugin): none
- [x] docker compose down -v --rmi local --remove-orphans: ok
- [x] no containers of project e2eds-mur5jw7i (docker ps -a): none
- [x] no volumes of project e2eds-mur5jw7i (docker volume ls): none
- [x] no networks of project e2eds-mur5jw7i: none
- [x] quit Docker Desktop (docker info fails, no com.docker.backend process): stopped (osascript quit was ignored for 30s; `docker desktop stop`)
- [x] remove the temp dir: removed
