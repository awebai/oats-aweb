# aw command grammar

`grammar.json` is generated from the released aw recorded in its `version`
field, using `node scripts/capture-aw-argv.mjs /absolute/path/to/aw`.
It contains the full subcommand path and whether each help-listed flag takes
an argument. The grant, setup, wake and standalone join-from fakes validate
before acting and exit 2 with argv for an unknown flag.

This capture is not compatibility proof. CI records the flags used while
hook paths run, then checks those complete command paths against each pinned
real aw's help. The recording contains command names and flag names only;
fixture values, tokens, keys and bodies are never recorded there.
