# Wake status timestamp evidence

`client-1.36.40-daemon-1.36.37.json` is a sanitized, reduced capture of a real
read-only `aw wake status --json` run on 2026-10-17. The separately observed
`aw version` was 1.36.40, commit
`0c7b167cace6cf0c2347eff624bc3a87b8117dcf`. The status reports daemon 1.36.37,
commit `74684f7350d8e692a440a5fe9bdd72e835020eea`. The CLI version is not a
field in that status response.

The capture retains one external-session row and its matching stream. Other
homes and streams were removed. Absolute paths, team IDs, trace/owner IDs and
the process ID were replaced with fixture values; all retained timestamps,
field presence, worker states, policy and stream observations are unchanged.
The integration regression relocates the fixture home and team to its temporary
test home and synthetic team. The pure assessment uses the stored values. That
replay is fixture support, not proof of live receive or model consumption.

This is evidence for a 1.36.40 **client reading a 1.36.37 daemon**, not a
1.36.40 daemon capture or a separate 1.36.37 client run. A full sanitized status
from a running 1.36.40 daemon, including top-level `updated_at`, remains missing.
The timestamps-only issue excerpt is insufficient to substitute for it.

The existing parser accepts attached RFC 3339 fractional seconds. Malformed
values in tests are explicitly synthetic mutations, never captured failures.
The already released clock-ordering regression in `oats-aweb-1-18.test.mjs`
controls the read/clock order independently of these real wire timestamps.
