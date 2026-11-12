// lib/aw-record.mjs reads a record aw writes (`.aw/workspace.yaml`) in a closed grammar: on every
// file it accepts, its top-level values are the ones a YAML parser gives; every other file is
// refused (null). Each accepted row's expected values are what PyYAML's safe_load gives for the
// same text (scalars as their text, as aw's string fields take them; null for a key with no
// value). Each refused row is one form the grammar excludes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readAwRecord } from "../oats-package/capabilities/oats-aweb/lib/aw-record.mjs";

// The shape aw writes with Go's yaml.v3 (4-space sequence indent, a quoted timestamp): the
// committed aw 1.36.28 capture, and the same keys with a role and the presence fields aw 1.36.56
// adds after a connect.
const AW_1_36_28 = readFileSync(new URL("./fixtures/probe/native-workspace-1.36.28.yaml", import.meta.url), "utf8");
const AW_CONNECTED = `aweb_url: https://record.invalid/api
memberships:
    - team_id: t:example.test
      alias: retained
      workspace_id: 0f1e2d3c-4b5a-4968-8776-655443322110
      cert_path: team-certs/t__example.test.pem
      joined_at: "2026-11-12T00:00:00Z"
human_name: Seat fixture
agent_type: agent
role_name: reviewer
hostname: host-fixture
workspace_path: /srv/seats/retained
updated_at: "2026-11-12T00:00:00Z"
`;

const accepted = [
  ["aw 1.36.28's capture", AW_1_36_28, { aweb_url: "https://app.aweb.ai/api", memberships: null, human_name: "Probe fixture", agent_type: "agent" }],
  ["a connected record with a role", AW_CONNECTED, { aweb_url: "https://record.invalid/api", memberships: null, human_name: "Seat fixture", agent_type: "agent", role_name: "reviewer", hostname: "host-fixture", workspace_path: "/srv/seats/retained", updated_at: "2026-11-12T00:00:00Z" }],
  ["a path prefix and an IPv6 literal", "aweb_url: https://record.invalid/aweb/api\nother: http://[2001:db8::1]:8000/api\n", { aweb_url: "https://record.invalid/aweb/api", other: "http://[2001:db8::1]:8000/api" }],
  ["double and single quotes", "aweb_url: \"https://record.invalid/api\"\nrole_name: 'reviewer'\n", { aweb_url: "https://record.invalid/api", role_name: "reviewer" }],
  ["a comment after a value, and comment and blank lines", "# written by aw\n\naweb_url: https://record.invalid/api # the team's server\n  # an indented comment\nrole_name: reviewer\n", { aweb_url: "https://record.invalid/api", role_name: "reviewer" }],
  ["a # inside a plain value", "aweb_url: https://record.invalid/api#frag\n", { aweb_url: "https://record.invalid/api#frag" }],
  ["Windows line endings", "aweb_url: https://record.invalid/api\r\nrole_name: reviewer\r\n", { aweb_url: "https://record.invalid/api", role_name: "reviewer" }],
  ["a key with no value", "aweb_url:\nrole_name: reviewer\n", { aweb_url: null, role_name: "reviewer" }],
  ["an empty file", "", {}],
];

const refused = [
  ["a flow mapping holding another aweb_url (round 5's case)", "\"aweb_url\": https://actual.invalid/api\nother: {\naweb_url: https://wrong.invalid/api\n}\n"],
  ["a column-0 aweb_url inside a multi-line quoted scalar", "note: \"first\naweb_url: https://wrong.invalid/api\n\"\n"],
  ["a flow mapping value", "other: {a: 1}\n"],
  ["a flow sequence value", "other: [a, b]\n"],
  ["a literal block scalar", "aweb_url: |\n  https://record.invalid/api\n"],
  ["a folded block scalar", "aweb_url: >\n  https://record.invalid/api\n"],
  ["a plain value continued on the next line", "aweb_url: https://record.invalid/path\n  tail\n"],
  ["a plain value continued after a blank line", "aweb_url: https://record.invalid/path\n\n  tail\n"],
  ["an escaped double-quoted value", "aweb_url: \"https://record.invalid/\\u0061pi\"\n"],
  ["a single-quoted value with an escaped quote", "role_name: 'it''s'\n"],
  ["an unclosed quote", "aweb_url: \"https://record.invalid/api\n"],
  ["an anchor", "aweb_url: &a https://record.invalid/api\n"],
  ["an alias", "role_name: *a\n"],
  ["a tag", "aweb_url: !!str https://record.invalid/api\n"],
  ["a quoted key", "\"aweb_url\": https://record.invalid/api\n"],
  ["a complex key", "? aweb_url\n: https://record.invalid/api\n"],
  ["a directive", "%YAML 1.2\naweb_url: https://record.invalid/api\n"],
  ["a document marker", "---\naweb_url: https://record.invalid/api\n"],
  ["a document end marker", "aweb_url: https://record.invalid/api\n...\n"],
  ["a byte-order mark", "\ufeffaweb_url: https://record.invalid/api\n"],
  ["a tab-indented nested line", "memberships:\n\t- team_id: t:example.test\n"],
  ["a nested line under a key with a value", "aweb_url: https://record.invalid/api\n    alias: retained\n"],
  ["a sequence at column 0", "memberships:\n- team_id: t:example.test\n"],
  ["a duplicate key", "aweb_url: https://record.invalid/api\naweb_url: https://other.invalid/api\n"],
  ["a key with no space before its value", "aweb_url:https://record.invalid/api\n"],
  ["a plain value holding a mapping indicator", "role_name: a: b\n"],
  ["a plain value holding a mapping indicator before a tab", "role_name: a:\tb\n"],
  ["a plain value starting with an indicator", "role_name: -reviewer\n"],
  ["a line that is not an entry", "just text\n"],
  ["a line separator, a line end to YAML 1.1 parsers", "aweb_url: https://record.invalid/a\u2028role_name: b\n"],
  ["a paragraph separator", "aweb_url: https://record.invalid/a\u2029b\n"],
  ["a next-line character", "aweb_url: https://record.invalid/a\u0085b\n"],
  ["a lone carriage return", "aweb_url: https://record.invalid/a\rrole_name: b\n"],
];

for (const [name, text, values] of accepted) {
  test(`accepted: ${name}, with the values YAML gives`, () => {
    const entries = readAwRecord(text);
    assert.ok(entries, "accepted");
    assert.deepEqual(Object.fromEntries(entries), values);
  });
}
for (const [name, text] of refused) {
  test(`refused: ${name}`, () => assert.equal(readAwRecord(text), null));
}
