# Admission and removal records: the states

How an opted-in home's admission records move, from spec human-ids-acxy7
(C-3, C-3d, C-5, C-6, C-8). `lib/admission-states.mjs` implements this table:
every path that reads or writes a record asks it, and
`test/attribution-states.test.mjs` runs every cell. A cell marked **[decided: X]** was
not settled by the spec, and the lead decided it (mail
18adc37d-1f51-4bda-b9f2-a2d9150a97c4); the decisions are at the end.

## The records

- **The admission record**: `.oats-aweb/admission-<label>.json`, one per team
  label, written before prepare (C-3b). It holds the team, alias, member key,
  operation id, policy, `--certificate-out` path, identity home and state.
- **The certificate**: `.oats-aweb/admission-<label>.cert`, admit's
  `--certificate-out`, which aw writes. OATS never creates it.
- **The root's copy**: `<root home>/admissions/<certificate_id>.cert`, written
  right after admit's certificate verifies, before install (C-3).
- **The removal record**: `.oats-aweb/removal-<label>.json` at retire and
  leave, `<root home>/removals/<certificate_id>.json` at reconcile. It holds
  the removal's operation id, persisted before prepare (C-6).
- **A left record**: `admission-<label>~left-<certificate_id>.json`, where a
  leave keeps a committed record it couldn't remove, so a later join of the
  label starts its own; retire and reconcile still act on it.

## States

| State | Meaning |
|---|---|
| none | no record: no key for this label, or a record never written |
| keyed | the child's key is recorded, no operation yet **[decided: K]** |
| pending | an operation id is persisted; the admit may or may not have run |
| unknown | the admit ran and its outcome is unknown |
| committed | the admission committed: a membership exists |
| refused | the operation was refused: no membership exists |
| removed | the root removed the membership |

**Facts each cell reads:**
- *cert*: the certificate file verifies: aw's id form, and the record's team
  and member key (`admittedCertificate`, C-3d).
- *copy*: the root's copy exists.
- *root*: it can act, or can't, with C-6's reason: `root-home-missing`,
  `root-home-unsafe`, `profile-changed` or `root-revoked`. `service-refused`
  is an answer, below. Fixable reasons: `root-home-unsafe`, `profile-changed`,
  `service-refused`.
- *sent*: the operation may have reached the service: a retry in this call,
  or a resumed pending or unknown record.

**aw's admit answers, classed** (C-9's admit column):
- *committed*: `state: committed`, the certificate written;
- *final*: the operation's own final codes: `admission_policy_missing`,
  `policy_changed`, `admission_limit_reached`, `subject_ineligible`,
  `operation_expired`, `approval_expired`;
- *requester*: `scope_refused`, `profile_scope_refused`,
  `profile_scope_ambiguous`, `operation_conflict` (refused at a first send,
  by C-9), and `signed_request_invalid`, `authority_changed`,
  `operation_mismatch` (unknown at a first send: in no row of C-9's table);
- *exists*: `certificate_out_exists`: the file holds another certificate;
- *unknown*: every other code, or none.

**aw's remove answers, classed** (C-6, mapped at aweb 44158f1bb):
- *removed*: `state: committed` for this certificate;
- *unavailable*: `handoff_http_404`, `handoff_http_405`, `handoff_http_501`;
- *unconfirmed*: the unconfirmed row, any `*_unavailable`, `handoff_http_429`,
  `handoff_http_5xx`, no code, or an answer that isn't committed;
- *refused*: every other code (`service-refused`).

## A. Spawn's admission, and a rerun of it (spawn, join, a join's rerun)

`admitIdentity`, for each identity a spawn or join makes. A spawn's failure
after the key exists reports the identity, and the kernel's rollback retire
runs table B then C.

| Record | Next | What happens |
|---|---|---|
| none | keyed | key created, then the chain |
| keyed, or refused | pending | a new operation id, persisted, then admit |
| removed | keyed | a new key and, then, a new operation: a leave deleted the old identity **[decided: R]** |
| pending or unknown, no cert | (same) | the same operation, sent again (C-3b's exact retry); *sent* |
| pending or unknown, cert | committed | no admit: install and connect from the certificate, the check retire makes **[decided: P]** |
| committed, cert | committed | no admit: install and connect from the certificate |
| committed, no cert | committed | the exact retry of its operation returns the certificate |
| another key's pending, unknown or committed | (same) | refuse `E_ATTRIBUTION_EXCHANGE` `step: key`: retire settles it **[decided: F]** |

Then admit's answer:

| Answer | Next | Writes | Exit and text |
|---|---|---|---|
| committed | committed | the root's copy, then the record, then install, connect | 0 |
| unknown, exists, or a requester code in no C-9 row, first attempt | (same) | nothing | retried once, the same operation; *sent* |
| the same, second attempt | unknown | the record | 1, `E_ADMISSION_UNKNOWN`, the home kept |
| final | refused | the record | 1, `E_ADMISSION_REFUSED` or `E_ADMISSION_LIMIT` |
| a requester code C-9 refuses, not *sent* | refused | the record | 1, `E_ADMISSION_REFUSED` **[decided: Q]** |
| a requester code C-9 refuses, *sent* | unknown | the record | 1, C-9's text (`E_ADMISSION_REFUSED`), the record kept unknown (C-3d) |
| any failure, record committed | committed | nothing | 1, that answer's refusal |

Install's or connect's failure leaves the record committed, with the root's
copy: `E_ATTRIBUTION_EVIDENCE` (`registry_unavailable`, retry) or
`E_ATTRIBUTION_EXCHANGE` (`step: install` or `connect`).

## B. Retire, settling (before any workspace delete)

`retireAdmissions` phase `settle`, for each record, in every retire: the
primary's, the rollback retire, a retained seat's, and a leave's own label.

| Record | Root | Next | What happens |
|---|---|---|---|
| none, keyed, refused, removed | any | (same) | nothing |
| pending or unknown, cert | any | committed | the record says committed; then as committed (row below) |
| pending or unknown, no cert | can act | per the resume's answer | the same admit from the root's home |
| pending or unknown, no cert | fixable reason | (same) | exit 1, the home kept: "fix the root, then retire again, which resumes the admission" |
| pending or unknown, no cert | `root-revoked`, `root-home-missing` | (same) | warn `admission-removal-blocked`; the home goes, the record with it |
| committed, no copy | root home exists | committed | the copy written from the certificate, else from the identity's installed certificate when it carries the record's id (C-6) |
| committed, no copy | root home gone | committed | nothing (C below says why) |

The resume's answer:

| Answer | Next | Exit and text |
|---|---|---|
| committed | committed | the root's copy written; then C |
| final | refused | nothing more |
| requester | (same) | exit 1, the home kept: `service-refused`, fix the root, then retire again |
| exists | (same) | exit 1, the home kept: move that file aside, then retire again **[decided: X]** |
| unknown | (same) | exit 1, the home kept: retire again once the service answers |

## C. Retire, removing (after the primary's workspace delete)

`retireAdmissions` phase `remove`, for each committed record. Outside aweb's
hosted zone this runs after the primary's workspace delete; inside it no
delete runs (v4.3.25), and C runs alone.

| Condition | Next | Exit and text |
|---|---|---|
| remove not served by the pinned aw | committed | warn `admission-removal-unavailable`; the home goes |
| the root can't act (any reason) | committed | warn `admission-removal-blocked` with the reason; the home goes; the copy kept |
| the root can act, no copy | committed | warn `admission-removal-blocked` `root-copy-missing`; the home goes |
| the root can act, copy | per the answer | the removal, its operation id persisted first |

The removal's answer:

| Answer | Next | Writes | Exit and text |
|---|---|---|---|
| removed | removed | the copy deleted, the removal record committed | 0 |
| unavailable | committed | nothing | warn `admission-removal-unavailable`; the home goes |
| unconfirmed | committed | the removal record kept pending | exit 1, the home kept; the rerun reuses its operation id |
| refused | committed | nothing | warn `admission-removal-blocked` `service-refused`; the home goes **[decided: S]** |

A rerun after an unconfirmed removal never sends the workspace delete again:
the default-retire marker says it ran (C-6).

## D. Leave (`oats aweb leave`, an opted-in deployment)

B then C for the label's own record (never a left one), then:

| After C | The joined identity | The record |
|---|---|---|
| removed | deleted | removed; the certificate file deleted |
| committed (blocked or unavailable) | deleted | moved aside as a left record, with its certificate **[decided: L]** |
| B or C kept the home | kept | (same): exit 1, rerun the leave |
| no record (joined before the opt-in) | the legacy leave | — |

A joined identity that never connected (no `workspace.yaml`: a join killed
after its key, refused, or whose install or connect failed) has no workspace
to delete: it is deleted locally, with no workspace delete, which aw would
refuse for want of a service URL. The record's row above still applies.
"Never connected" is read from the identity home alone: no `workspace.yaml`.
A home that connected and then lost that file takes the same local delete,
and its workspace at the service is left to go stale; a leave never sends a
delete it can't address.

## E. What reads records and writes none

| Reader | Reads |
|---|---|
| start (C-4) | no record moves. A joined team that is no longer eligible with a record that isn't removed stays joined, with a warning: only the root removes it (round 5) |
| readiness | each unknown record: `admission-leaked` |
| check-only `admittedLive` | live homes' committed records, left ones included: OATS's count |
| check-only `leakedMemberships` | the member list read through a home whose committed record's identity home exists, else the root; and the root's copies. A certificate a live or kept home's committed, pending or unknown record names (or, awaiting, may name, by the certificate's alias) is that home's; a left record names none (decided L). A list row is unsigned registry metadata: it counts only by the root's copy of its id, of aw's form, whatever alias the row gives; with no copy it is listed, never removable, and only when its alias has no home |
| `--reconcile-admissions` | the root's copies only, for the leaks above, read once before the homes' records: every copy then has its record (a record is written before admit, the copy after it), and a copy a join writes during the reads is no candidate; its removal records under the root's `removals/` |
| check-only, a profile that fails C-1's checks | no policy read and no member list; the block's `problem` names `profile-mode` or `profile-changed`, and its local parts stay |
| a spawn's issuer count (`E_ADMISSION_LIMIT`) | as `admittedLive` |

## Concurrent commands

Nothing serializes commands on one home or one root, so every path that reads
records or copies, makes a slow aw call, then acts destructively, rests on one
order: **a home writes its admission record (pending) before the admit, and
the root's copy only after the admit commits** (C-3, C-3b). The kernel lists a
spawning home from its first `instance.json`, before the spawn hooks run.

- **Reconcile** reads the root's copies once, before the homes' records, and
  only that snapshot is a removal candidate: every snapshotted copy has its
  record in the later read, and a spawn or join that commits during the
  member-list reads adds a copy the snapshot never holds.
- **Retire's removals** act only on certificates the home's own records
  name, through the root's copy of each; certificate ids are unique, so no
  other home's membership is reached. A join that commits during a retire
  leaves its copy for reconcile: a leak, never a revocation.
- **The rollback retire** runs on a failed spawn's home, which no session
  uses.
- **Leave**'s only aw call after it reads the record is the root's removal; a
  join of the same label at that point finds the label joined and its record
  committed, and admits nothing. A join and a leave of one label run at once
  are otherwise unordered: the leave can delete what the join made, which the
  home's retire then removes.
- **Reconcile and a retire** may remove one certificate twice; the second
  answers without effect on any other membership.

## The decided cells (the lead, mail 18adc37d-1f51-4bda-b9f2-a2d9150a97c4)

- **K.** `keyed` is a sub-state of none: no operation was sent, so nothing
  exists to remove or count.
- **R.** A removed record, then a join of the label: a new key, then a new
  operation.
- **P.** A verified `--certificate-out` is a signed result: pending or unknown
  with one reads as committed at every resume, a rerun's as retire's, and the
  admit is skipped. Install-cert still checks it against the registry.
- **F.** A record of another key is never overwritten.
- **Q.** A first send refused for the requester records refused: nothing was
  prepared, so no operation of that id exists, and a rerun starts a new one.
- **S.** A resume that committed is committed: a refused removal then follows
  C-6's committed row (warn `service-refused`, keep the root's copy, remove
  the home), never the unknown row's keep.
- **L.** A leave keeps a record it couldn't remove aside, with its
  certificate, so retire, reconcile and `admittedLive` still see it.
- **X.** A resume answered `certificate_out_exists` keeps the home: move that
  file aside, then retire again; the resume then writes the certificate.
