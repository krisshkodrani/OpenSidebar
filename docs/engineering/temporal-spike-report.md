# LP-32 Temporal OSS exact-host spike report

Date: 2026-08-08  
Host: Lightsail `small_3_0`, 2 vCPU, 2 GB RAM, 60 GB disk, `eu-central-1`  
Recommendation: **Do not adopt Temporal on the current shared $12 host.**

This is an engineering recommendation, not a new owner Decision Stamp. LP-32
remains a bounded research spike. PostgreSQL/S3 and LP-29–31 remain authoritative,
and every user-facing flag remains disabled.

## Result

Temporal passed the durability, privacy, backup/restore, replay, and rollback
tests. It did not pass the shared-host latency/isolation gate:

- the corrected required 25-device burst measured 6,504 ms p95 from reconnect
  to command delivery, above the 5,000 ms target;
- during a sustained corrected-load run, Playground backend and Celery health
  checks timed out; Celery recovered after Temporal stopped, while the backend
  required a container restart;
- no process was OOM-killed and Temporal itself did not restart, so this was
  contention/latency failure rather than data loss;
- the spike adds about 1,190 lines of Temporal-specific source and operations
  code and has not yet removed more recovery code than it adds.

LP-32 says a resource-only threshold failure keeps the PostgreSQL state machine
and revisits Temporal only on a larger or multiple-host topology after a new
owner decision. Enlarging this server solely to make Temporal pass is forbidden.

## Threshold scorecard

| Adoption threshold | Result | Evidence |
| --- | --- | --- |
| No content/secrets in history, visibility, logs, metrics, or errors | Pass | Automated canary scans returned zero for server/worker logs and both Temporal databases, including after clean-host restore. |
| Replay and failure drills converge without duplicate effects | Pass | Seven fixed fixtures, duplicate acknowledgement/result delivery, lost response, stale lease generation, worker/server/PostgreSQL/host restart, and operator recovery passed. |
| Steady memory below 75%; stressed below 85%; no OOM/thrashing | Pass | 120-batch soak peaked at 74% physical use, minimum 496.3 MiB available; zero OOM/restarts. Swap was flat with effectively no swap-out in live `vmstat` samples. |
| CPU headroom for API/relay and Playground | **Fail** | Cloud API stayed healthy, but Playground backend/Celery health checks timed out under the corrected sustained run. |
| Reconnect-to-delivery p95 below five seconds | **Fail** | Corrected 25-device burst p95 was 6,504 ms; full completion p95 was 6,697 ms. |
| At least 40% disk free with retention/compaction | Pass | 49% remained free after the long soak; PostgreSQL data was about 536 MB. |
| Clean replacement-host restore under four hours | Pass | Checksummed encrypted dumps restored in 8 seconds after prerequisites; 18 application, 39 Temporal, and 3 visibility tables restored. Pinned Temporal booted against the restored databases and listed restored workflows without a published port. |
| Weekly maintenance below one operator-hour | Provisional pass | Corrected runbook operations fit comfortably below one hour, but the spike exposed bootstrap, readiness, and shell-exit pitfalls that were fixed in the scripts. |
| Removes more recovery code than the platform adds | **Fail** | No production recovery path has been removed; the research platform currently adds about 1,190 lines. |

## Exact-host evidence

The 643-second soak ran 120 consecutive batches:

- 3,600 workflows;
- 3,000 reconnect devices;
- 6,000 duplicate signals;
- 3,600 checkpoint commits;
- zero workflow failures;
- worst full-completion batch p95 6,535 ms;
- 152 host sampling intervals and 1,520 total resource records;
- Temporal peak 294.4 MiB; worker peak 162.9 MiB; PostgreSQL peak
  320.6 MiB;
- minimum disk availability 27.97 GiB;
- cloud API, Playground, and PostgreSQL were healthy at the end of this soak.

The subsequent corrected-latency run was stopped when Playground health checks
timed out. This negative result is the decisive isolation evidence and must not
be averaged away with earlier passing runs.

## Backup and clean-host restore

The backup drill created encrypted, checksummed custom-format dumps for:

- the shared `opensidebar` application database;
- Temporal persistence;
- Temporal visibility.

A fresh exact-size Lightsail host received no DNS, application traffic, static
IP, bucket access, or product secrets. It restored all three dumps with
`pg_restore --exit-on-error`. The pinned Temporal 1.30.4 server then started
against the restored databases, found namespace `opensidebar-spike`, and listed
restored workflow history. Its gRPC port was not published. All temporary
instances and the ephemeral recovery identity were deleted after evidence was
preserved.

## Rollback and current state

- No Temporal container remains on the shared host.
- Cloud API, Playground backend, Celery, and PostgreSQL are healthy.
- Temporal/cloud-session production flags are absent/default-disabled.
- Cloud service typecheck passes; 43 tests pass and two real-PostgreSQL tests
  remain environment-skipped in the local suite.
- Thirteen focused extension checkpoint/session/device/cloud-client tests pass.
- PostgreSQL-authoritative session, checkpoint, and device coordination paths
  remain independently operable.

## Revisit conditions

Do not enable shadow or authoritative Temporal on the current shared host. A
future RFC/owner decision may reopen evaluation only with resource isolation,
for example a separate host, and must repeat the fixed peak, corrected delivery
latency, Playground-neighbor load, clean restore, privacy, and rollback gates.
