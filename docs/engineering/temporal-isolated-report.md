# LP-33 isolated $7 Temporal evaluation report

Date: 2026-08-09  
Host: Lightsail `micro_3_0`, 2 vCPU, 1 GB RAM, 40 GB disk, `eu-central-1`  
Recommendation: **Reject full Temporal isolation on the $7 host.**

This is an engineering result, not authorization to upgrade. PostgreSQL/S3 and
LP-29 through LP-31 remain authoritative. Temporal and cloud-session product
flags remain disabled.

## Result

The dedicated host booted Temporal Server 1.30.4, the Node worker, and separate
PostgreSQL persistence without publishing any service port. The fixed fixtures
and corrected five-session/25-device burst completed without workflow failure,
duplicate effect, restart, or OOM. The topology nevertheless failed two hard
LP-33 gates:

- reconnect-to-delivery p95 was 6,998 ms, above the 5,000 ms maximum;
- the first 60 resource samples reached 126.9 MiB minimum available memory,
  below the continuously available 150 MiB minimum.

During the longer load the live host later showed about 104 MiB available and
319 MiB swap occupied. The load was stopped because the already-failed gate was
progressively swap-bound. The stack cleanup completed and the host returned to
about 518 MiB available memory. No named tester or authoritative traffic was
enabled.

## Corrected burst

- 5 concurrent sessions;
- 25 reconnecting devices;
- 25 duplicate acknowledgements and 25 duplicate results;
- 30 checkpoint commits;
- zero failures;
- full latency p95 7,532 ms;
- reconnect-to-delivery p95 6,998 ms.

## Operational findings

Initial cloud-init failed because Ubuntu 24.04 did not offer the `awscli` APT
package. The bootstrap now installs AWS CLI through Snap and successfully
installs Docker, Compose, and 1 GB emergency swap. Schema initialization was
also made restart-idempotent before the measured run.

Evidence is retained locally under
`.artifacts/temporal-isolated/live-20260809-r2/`. After the owner parked the
Temporal plan, the `opensidebar-temporal-shadow` Lightsail instance was
permanently deleted on 2026-08-09. It no longer incurs the $7 monthly charge.

## Next decision

Temporal is parked. Do not provision another host, enable Temporal, or run named
testers without a new owner-stamped RFC. The retained implementation and test
evidence are research material only; PostgreSQL remains authoritative.
