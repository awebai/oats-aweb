# Upgrade metadata fixtures

Literal successful hook metadata shapes from `git show v1.17.1:oats-package/capabilities/oats-aweb/bin/oats-aweb.mjs`: local spawn (line 1328), global grant spawn (line 640), and retained spawn (line 825). Current shapes come from main `1f2bc30` in the same file: local `startedMeta` and joined-team state, and global grant `startedMeta` including seat, ttl and renew. All identifiers, addresses and paths are synthetic; these are not captures of live homes.

The global fixture intentionally has no top-level team/alias, seat, ttl, renew or runtime: that is the older successful spawn shape. End-to-end tests replace only its grant-home locator with their temporary home, and choose renewal through settings, as a real launch does.
