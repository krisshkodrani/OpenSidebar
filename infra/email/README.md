# OpenSidebar authentication email

The dedicated Cognito `CustomEmailSender` uses the existing OpenSidebar identity,
SES in Frankfurt, a dedicated shared authentication-email KMS key, and HTML plus
plain text. It preserves passwordless sign-in and MFA settings. The sender is
`OpenSidebar <no-reply@opensidebar.com>`; replies go to `support@playscenario.ai`
as requested by the operator.

`sign-in.html` follows the site palette. `message.mjs` adapts it for all Cognito
sender events, and `handler.mjs` validates the pool and encryption context before
delivery. IAM permits decryption only for this pool and sending only from the
OpenSidebar identity. No email addresses, events or codes are logged.

Run `npm ci --workspaces=false` and `npm test --workspaces=false` in this directory
with Node 24. The Lambda ZIP includes the three runtime source files and pinned
production dependencies. It is independent of the cloud-service Docker image.

The operator must preserve every pool setting when attaching or rolling back the
trigger. Restore the prior LambdaConfig to return to Cognito delivery; do not
change MFA policy to obtain custom email styling. Retain the shared encryption key
while PlayScenario also uses it. Live deployment evidence and rollback state are
protected under the consolidation operation's `private/email-deploy/` directory.

Browser previews verify desktop/mobile layout; actual mailbox rendering and
real sign-in delivery require a human check. Local previews use fictional codes.
