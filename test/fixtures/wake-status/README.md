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
1.36.40 daemon capture or a separate 1.36.37 client run.

`daemon-1.36.40-issue-excerpt.json` is a sanitized copy of the reduced status
excerpt [posted by the operator on issue #132](https://github.com/awebai/oats-aweb/issues/132#issuecomment-6230535181)
on 2026-10-17. It reports daemon 1.36.40, top-level `updated_at`, and one
external-session row. The issue reports client 1.36.40, but the excerpt itself
contains no client-version field. Paths, team and owner/trace IDs were replaced;
all timestamps, field presence, states, errors and stream observations remain
unchanged. The retained worker error is not evidence of a healthy endpoint.

The 1.36.40 excerpt omits `daemon_running` and `daemon_version_state`, so it
cannot establish the complete broker prerequisites on its own. The regression
checks the original excerpt's timestamps and its incomplete-daemon diagnostic.
A separate explicitly synthetic augmentation supplies those two missing flags
only to exercise timestamp assessment and retained-error warnings. It is not a
captured full response or a claim of live receive. A full status response from
a running 1.36.40 daemon remains missing; the earlier timestamps-only issue
comment is distinct from this later reduced status excerpt.

The existing parser accepts attached RFC 3339 fractional seconds. Malformed
values in tests are explicitly synthetic mutations, never captured failures.
The already released clock-ordering regression in `oats-aweb-1-18.test.mjs`
controls the read/clock order independently of these real wire timestamps.
