# Binary plist fixtures for `oats aweb wake`

launchd reads binary property lists as well as XML ones, so the wake
service's recogniser decodes `bplist00` itself. These files were written by
Python's `plistlib.dumps(..., fmt=plistlib.FMT_BINARY)` (Python 3, 2026-10-15),
an encoder independent of the decoder they test:

| File | Contents |
| --- | --- |
| `foreign-binary.plist` | Label `com.me.wake`, ProgramArguments `/usr/local/bin/aw wake run`, RunAtLoad, KeepAlive, an environment with a non-ASCII (UTF-16) value, an integer |
| `program-binary.plist` | Label `com.me.wake2`, Program `/opt/homebrew/bin/aw`, ProgramArguments `aw-broker wake run --max-streams 8` |
| `custody-binary.plist` | Label `ai.aweb.custody.x.y`, ProgramArguments `/usr/local/bin/aw custody serve` (not a wake unit) |
