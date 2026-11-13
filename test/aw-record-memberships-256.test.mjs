// awebai/oats-aweb#256: the team ids a retained seat's teams.yaml records (lib/aw-record.mjs
// readMembershipTeamIds), read in the closed grammar aw writes, and the rule aw matches a team
// against them by (lib/aweb-team-id.mjs membershipTeamMatch).
//
// aw 1.36.58 writes teams.yaml as yaml.Marshal of awconfig.TeamState, trailing newlines
// trimmed and one "\n" added (cli/go/awconfig/team_state.go:14-26, 347-357), with yaml.v3
// v3.0.1 (cli/go/go.mod). Each "yaml.v3 writes" row below is that marshal's exact output for
// the state its name gives, captured from yaml.v3 v3.0.1 on those types. Each refused row is a
// form outside the grammar, from which nothing is decided.
import test from "node:test";
import assert from "node:assert/strict";
import { readMembershipTeamIds } from "../oats-package/capabilities/oats-aweb/lib/aw-record.mjs";
import { membershipTeamMatch } from "../oats-package/capabilities/oats-aweb/lib/aweb-team-id.mjs";

const read = [
  ["yaml.v3 writes: one full membership", `active_team: default:example.test
memberships:
    - team_id: default:example.test
      alias: retained
      cert_path: team-certs/default__example.test.pem
      joined_at: "2026-11-12T00:00:00Z"
      registry_url: https://registry.example.test
      aweb_url: https://record.invalid/api
`, ["default:example.test"]],
  ["yaml.v3 writes: two memberships", `active_team: b:example.test
memberships:
    - team_id: a:example.test
      cert_path: team-certs/a__example.test.pem
    - team_id: b:example.test
      cert_path: team-certs/b__example.test.pem
`, ["a:example.test", "b:example.test"]],
  ["yaml.v3 writes: no active team", "memberships:\n    - team_id: a:example.test\n      cert_path: x.pem\n", ["a:example.test"]],
  ["yaml.v3 writes: an empty team id", "memberships:\n    - team_id: \"\"\n      cert_path: \"\"\n", [""]],
  ["yaml.v3 writes: values it quotes", "active_team: 'a: b'\nmemberships:\n    - team_id: 'x #y'\n      cert_path: 'trail '\n", ["x #y"]],
  ["yaml.v3 writes: a colon inside a plain value", "memberships:\n    - team_id: a:b\n      cert_path: a::b\n", ["a:b"]],
  ["Windows line endings and a comment", "# written by aw\r\nmemberships:\r\n    - team_id: a:example.test # the seat's team\r\n      cert_path: x.pem\r\n", ["a:example.test"]],
  ["an item whose team_id has no value, or that has none", "memberships:\n    - team_id:\n      cert_path: x.pem\n    - cert_path: y.pem\n", ["", ""]],
  ["a plain null or ~ comes back as its text, which no team id equals", "memberships:\n    - team_id: null\n    - team_id: ~\n", ["null", "~"]],
  ["a top-level key named like a scope", "top:\n    - team_id: a:example.test\nmemberships:\n    - team_id: b:example.test\n", ["b:example.test"]],
  ["memberships with no value: none", "active_team: a:example.test\nmemberships:\n", []],
];
const noList = [
  ["yaml.v3 writes: no memberships", "active_team: a:example.test\n"],
  ["an empty file", ""],
  ["memberships with a scalar value", "memberships: none\n"],
];
const refused = [
  ["yaml.v3 writes: an empty state, as a flow mapping", "{}\n"],
  ["yaml.v3 writes: an escaped single quote", "memberships:\n    - team_id: '''q'''\n      cert_path: '\"d\"'\n"],
  ["yaml.v3 writes: an escape in a double-quoted value", "memberships:\n    - team_id: a:example.test\n      cert_path: \"a\\tb\"\n"],
  ["yaml.v3 writes: a block scalar", "memberships:\n    - team_id: |-\n        a\n        b\n      cert_path: x.pem\n"],
  ["yaml.v3 writes: a plain value starting with an indicator", "memberships:\n    - team_id: '#x'\n      cert_path: -x\n"],
  ["yaml.v3 writes: a plain value starting with a colon", "memberships:\n    - team_id: :a\n      cert_path: x.pem\n"],
  ["a flow sequence", "memberships: [a]\n"],
  ["an item at another indentation", "memberships:\n  - team_id: a:example.test\n"],
  ["a key at another indentation", "memberships:\n    - cert_path: x.pem\n        team_id: a:example.test\n"],
  ["a team_id repeated in one item, which yaml.v3 refuses", "memberships:\n    - team_id: a:example.test\n      team_id: b:example.test\n"],
  ["a tab-indented item", "memberships:\n\t- team_id: a:example.test\n"],
  ["a duplicate top-level key", "memberships:\n    - team_id: a:example.test\nmemberships:\n    - team_id: b:example.test\n"],
];

for (const [name, text, ids] of read) test(`read: ${name}`, () => assert.deepEqual(readMembershipTeamIds(text), ids));
for (const [name, text] of noList) test(`no memberships list: ${name}`, () => assert.equal(readMembershipTeamIds(text), null));
for (const [name, text] of refused) test(`refused: ${name}`, () => assert.equal(readMembershipTeamIds(text), undefined));

// aw's TeamState.Membership (cli/go/awconfig/team_state.go:100-113 at 1.36.58): both ids
// trimmed, then strings.EqualFold. Decided for ASCII ids only.
const matches = [
  ["the same id", "a:example.test", "a:example.test", true],
  ["a case-only difference", "Default:Example.Test", "default:example.test", true],
  ["surrounding whitespace", " a:example.test\t", "a:example.test", true],
  ["a trailing dot, which aw does not drop (sameAwebTeamId does)", "a:example.test.", "a:example.test", false],
  ["another team", "b:example.test", "a:example.test", false],
  ["an empty stored id", "", "a:example.test", false],
  ["an empty wanted id finds nothing", "", "", false],
  ["a non-ASCII stored id: not decided", "ä:example.test", "a:example.test", undefined],
  ["a non-ASCII wanted id: not decided", "a:example.test", "a:exämple.test", undefined],
  ["the Kelvin sign, which Go folds to k: not decided", "K:example.test", "k:example.test", undefined],
];
for (const [name, stored, wanted, expected] of matches) test(`membership match: ${name}`, () => assert.equal(membershipTeamMatch(stored, wanted), expected));
