# LP-32: Open-source Temporal on Lightsail spike and adoption gate

Status: Approved for a bounded research spike. Owner Decision Stamp recorded
2026-08-08. This RFC does not approve production adoption; the spike starts
only after LP-29–31 contracts are implemented.

## Summary

Evaluate whether open-source Temporal can reliably coordinate long-running
OpenSidebar sessions on the same $12 Lightsail instance as the Node API and
PostgreSQL. Temporal is not the session database, browser executor, secret
store, or source of user-visible state. It may later coordinate waits, retries,
approvals, reconnects, checkpoint commits, retention, and deletion.

There is no Temporal Cloud in this plan. The software has no license charge;
its real cost is memory, CPU, disk, operational complexity, and contention with
the API and Playground.

## Preconditions

- LP-29 PostgreSQL/S3 session storage is authoritative and independently
  restorable.
- LP-30 defines portable checkpoints and safe re-grounding.
- LP-31 defines commands, leases, cancellation, reconnect, and idempotency.
- The $12 host, backup, monitoring, and restore runbook from LP-28 are working.
- Product behavior works without Temporal through a PostgreSQL-backed state
  machine, so removing Temporal remains possible.

## Exact role

One workflow represents one cloud-enabled agent session. The workflow stores
only opaque identifiers, revisions, coarse states, deadlines, and error codes.
It coordinates:

1. wait for an eligible extension device;
2. issue a command identified by stable `commandId` and `attempt`;
3. wait for acknowledgement, completion, cancellation, or lease expiry;
4. request an LP-30 checkpoint commit through an idempotent activity;
5. wait durably for user approval or a reconnect without keeping a Node timer;
6. close, archive, delete, or continue-as-new according to authoritative
   PostgreSQL state.

Browser actions still execute in the extension. Every side effect is authorized
and deduplicated by the LP-31 command journal. PostgreSQL and S3 remain the
read/restore model; Temporal history is coordination evidence only.

## Deployment on the $12 host

```text
Caddy
  -> Node API / relay / Playground
  -> Node Temporal worker

Temporal Server (single-node development topology)
  -> PostgreSQL database `temporal`

OpenSidebar application
  -> PostgreSQL database `opensidebar`
```

Use separate database names, owners, credentials, migration paths, and backup
checks. Bind Temporal frontend/admin ports to the private container/network
interface; expose no Temporal UI or gRPC endpoint publicly. The Node worker is
the only product process allowed to connect to Temporal.

The spike must use the exact production-shaped 2-vCPU/2-GB/60-GB Lightsail plan,
not a larger development machine. Start with conservative container/process
limits: PostgreSQL 400–550 MiB, Temporal 500–700 MiB, Node/Caddy/worker
350–500 MiB combined, leaving at least 250 MiB for the OS and burst headroom.
These are test budgets, not promises; measured peaks decide adoption.

## Workflow restrictions

Temporal inputs, memo, search attributes, signals, results, logs, and errors must
not contain prompts, model messages, page content, URLs, screenshots, provider
keys, checkpoint plaintext, cookies, authorization headers, emails, or account
identifiers. Use random session/device/command IDs and coarse enum values only.

Activities perform all network, clock, random, KMS, S3, and PostgreSQL I/O.
Workflow code must remain deterministic and replay-tested. Activity retries do
not imply safe browser retries; only the LP-31 journal may decide whether a
browser effect can run again.

Use continue-as-new after a measured history threshold and at stable checkpoint
boundaries. Cancellation requests stop future commands, revoke the active lease,
and wait for in-flight acknowledgement before terminal state. Account deletion
first revokes access in PostgreSQL, then requests workflow termination and
deletes session objects through an idempotent job.

## Spike

Implement a synthetic workflow and worker outside production routing. It must
demonstrate:

- start, signal/update, query, timer, cancellation, retry, and continue-as-new;
- worker restart, Temporal restart, PostgreSQL restart, and full host reboot;
- extension disconnect/reconnect and duplicate command/result delivery;
- checkpoint commit before and after a lost response;
- stuck activity/operator recovery without editing database rows;
- backup restore of both PostgreSQL databases on a clean replacement host;
- deletion of a synthetic account/session without content in history or logs;
- operation with the API, relay stub, and Playground load running concurrently.

The comparison implementation uses a PostgreSQL job/state table plus the same
idempotent activities. Record complexity, failure recovery, resource use, and
operator steps for both approaches.

### Fixed spike matrix

The spike report must record immutable image digests in addition to these
starting versions: the host's current `pgvector/pgvector:pg15` PostgreSQL 15
image, Node 22, and a current stable open-source Temporal Server/auto-setup
image plus matching TypeScript SDK. Every report records the resolved image
digest. The Temporal version is selected and vulnerability-scanned before the
bounded spike; an unpinned `latest` tag is forbidden. Region is
`eu-central-1`, database backups retain seven daily and 28 weekly copies, and
the exact-host target is the existing 2-vCPU/2-GB/60-GB Lightsail instance.

Container budgets start at PostgreSQL 512 MiB, Temporal 640 MiB, API 256 MiB,
worker 192 MiB, and Caddy/Playground/OS within the remaining measured headroom.
The load fixture is 25 registered devices, five active sessions, two concurrent
checkpoint commits, one relay stub stream, and Playground polling at its
few-user beta cadence. A separate burst repeats delivery/reconnect for all 25
devices after an API or Temporal restart.

Synthetic workflow fixtures are closed and content-free:

1. `normal`: start, lease, command acknowledgement, result, checkpoint commit,
   and completion;
2. `disconnect`: delivery, disconnect, duplicate redelivery, reconnect, and one
   terminal result;
3. `lost_commit_response`: idempotent checkpoint activity succeeds before its
   response is lost;
4. `approval_timeout`: durable wait, timeout, cancellation, and lease release;
5. `takeover_race`: old-device result races generation increment;
6. `continue_as_new`: measured history threshold at a stable checkpoint;
7. `account_delete`: access revocation, workflow termination, and idempotent
   metadata/object cleanup.

Every fixture injects forbidden-content canaries shaped as an email, URL,
authorization header, provider key, cookie, prompt, screenshot marker, and
checkpoint plaintext marker into activity-local inputs. Automated scans must
prove none appears in workflow input/result/history, memo/search attributes,
Temporal visibility, application/Temporal logs, metrics labels, errors, or
dead-letter/operator output. Only random opaque IDs, revisions, deadlines, and
closed status/error codes may cross the workflow boundary.

## Adoption thresholds

Adopt Temporal only if all conditions hold:

- no plaintext/user content appears in history, visibility, logs, metrics, or
  errors under automated canary tests;
- all replay and failure drills converge without duplicate browser effects;
- steady-state whole-host memory stays below 75% and a stressed few-user test
  stays below 85%, with no sustained swap thrashing or OOM restart;
- CPU has headroom for interactive API/relay latency and Playground polling;
- Temporal plus PostgreSQL growth fits the 60-GB disk with at least 40% free and
  documented retention/compaction;
- a clean-host restore completes within four hours using the written runbook;
- weekly maintenance is expected to remain under one operator-hour during beta;
- the workflow removes more retry/recovery code than the platform adds.

If any privacy, replay, restore, or duplicate-effect condition fails, reject it.
If only resource or operational thresholds fail, keep the PostgreSQL state
machine and revisit after moving to a larger/multiple host topology.

## Cost and upgrade gate

Temporal adds USD 0 in software fees on the existing server. It can still force
an infrastructure upgrade. The initial all-in AWS budget remains USD 25/month;
do not upgrade merely to preserve Temporal during the few-user test.

Move Temporal and its database off the application host only when measured
traffic requires it and a new owner decision approves the higher monthly floor.
Temporal Cloud, managed PostgreSQL, and a highly available Temporal cluster are
explicitly outside this RFC.

## Rollout if approved later

1. Run shadow workflows against synthetic sessions.
2. Mirror coordination events from internal sessions without issuing commands.
3. Enable one internal opt-in workflow while PostgreSQL remains authoritative.
4. Exercise restart, rollback, deletion, and clean-host restore again.
5. Enable a few named testers behind a kill switch.

Rollback stops new workflows and routes coordination to the PostgreSQL state
machine. Existing workflows drain or are safely cancelled; session read,
export, restore, and delete remain available without Temporal.

## Decision

Status: Needs more research

Chosen path:

- Evaluate only open-source Temporal on the existing $12 Lightsail host.
- Keep PostgreSQL/S3 and the LP-29–31 protocols authoritative and independently
  operable.
- Adopt Temporal only if the exact-host spike meets every threshold above.

Required edits before implementation:

- None.

Non-blocking follow-ups:

- Reconsider a separate host or managed service only after measured demand and
  a new cost/operations decision.

Do not do:

- Do not use Temporal Cloud, expose Temporal publicly, store user content or
  secrets in history, execute browser actions on the server, or make session
  restore depend exclusively on Temporal.
- Do not enlarge the server solely to make this spike pass.

Evidence required before merge:

- The complete spike report, resource graphs, replay/failure results,
  forbidden-content scan, PostgreSQL comparison, restore timing, and rollback
  demonstration.

Next action:

- Run spike
