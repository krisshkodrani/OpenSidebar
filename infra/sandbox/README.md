# OpenSidebar Sandbox deployment

Deploy in this order after `corepack pnpm install` has linked workspace dependencies:

1. `pnpm sandbox:typecheck` and `pnpm sandbox:synth`.
2. Deploy `OpenSidebarSandbox` with CDK, setting `controlOrigin`, `targetOrigin`, and a globally unique `cognitoDomainPrefix` context. The retained Cognito client accepts both the canonical `/api/v1/playground/auth/callback` and the legacy rollback callback.
3. Create a CloudFront cache-disabled policy and an origin-request policy that forwards the apex session cookie, `x-os-csrf`, `Origin`, and the authorization callback query string. Run `pnpm sandbox:attach-apex-api` with the four required `SANDBOX_*` environment variables. It also gives `/sandbox` HTML a no-cache behavior while leaving hashed assets on the normal asset cache policy.
4. Read `TargetBucketName` and `TargetDistributionDomain` from stack outputs. Set both target and main-site bucket/distribution variables, then run `pnpm sandbox:deploy`.
5. Add `play.opensidebar.com` as an alias on the target distribution with an ACM certificate in `us-east-1`, and point DNS at that distribution before public traffic.

The apex attach script removes the legacy global CloudFront 403-to-HTML rewrite. This is necessary: otherwise a failed authenticated API request would become a misleading `200` marketing page. All public marketing paths must therefore be deployed as exact S3 keys before that switch.

Before production access, verify Cognito email OTP delivery and the `opensidebar.com` SES sending identity, DKIM, SPF, and production-access state. No production target should be enabled until a fresh target launch proves that the apex `__Host-os_session` cookie is absent on `play.opensidebar.com`.
