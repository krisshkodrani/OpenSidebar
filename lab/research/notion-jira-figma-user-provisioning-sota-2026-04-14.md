# Research Note: SOTA for User Provisioning Across Notion, Jira, and Figma

**Date:** 2026-04-14
**Researcher:** OpenSidebar Lab
**Scope:** Current best practice for creating and managing users across Notion, Jira Cloud, and Figma, with emphasis on SSO, SCIM, admin UI flows, and browser-agent fallback
**Evidence grade:** D for architecture recommendations, vendor-doc backed for platform capability summary

## Executive Summary

The current best practice is:

1. Prefer identity-provider-driven provisioning via SCIM when the product supports it.
2. Use SAML SSO and JIT only where it meaningfully reduces manual onboarding.
3. Use admin invite flows for exceptions and low-volume operations.
4. Treat browser automation as a fallback for UI-only gaps, not as the default provisioning path.

Across these three products, the maturity pattern is uneven:

- **Atlassian/Jira Cloud** is the strongest identity-management surface. Atlassian documents user provisioning through Atlassian Guard Standard and exposes both admin and SCIM APIs.
- **Notion** supports SAML SSO, JIT provisioning, and Enterprise SCIM. This is adequate for enterprise onboarding, but it is still less infrastructure-rich than Atlassian.
- **Figma** supports manual org invites, SAML SSO, and SCIM-based provisioning. It is workable, but the operational model is more plan-sensitive and billing-sensitive.

For OpenSidebar, this domain should be modeled as a **high-risk workflow skill** with an **API/SCIM-first policy**.

---

## Capability Snapshot

| Product | Manual Admin Invite | SAML SSO | JIT | SCIM | Public Admin/API Surface |
| --- | --- | --- | --- | --- | --- |
| Notion | Yes | Yes | Yes | Yes, Enterprise | Help-center-documented admin + SCIM surface |
| Jira Cloud | Yes | Yes | Yes | Yes, via Atlassian Guard Standard | Strongest official admin + SCIM API surface |
| Figma | Yes | Yes | Not the primary pattern in the reviewed docs | Yes | Limited general provisioning API story; SCIM is the main automation path |

---

## Product Findings

### Notion

Official Notion help documents:

- SAML SSO support
- JIT provisioning
- SCIM-based user and group provisioning for Enterprise workspaces

Operationally, that means Notion is no longer a "browser-only" onboarding target. If the customer is on the right plan, the best path is:

1. SAML SSO for authentication
2. SCIM for lifecycle management
3. manual invite flow only for exceptions

Implication for OpenSidebar:

- Browser automation is justifiable for ad hoc invite/admin tasks.
- It is not the SOTA path for recurring provisioning.
- Notion should be classified as **identity-managed first, UI fallback second**.

### Jira Cloud / Atlassian

Atlassian has the most explicit enterprise provisioning story in this set. Official Atlassian support and developer docs cover:

- user provisioning tied to **Atlassian Guard Standard**
- SCIM provisioning
- org-level admin APIs for managing organization users and access

This makes Jira the clearest case where browser automation should usually be avoided for user creation at scale. The mature path is:

1. IdP integration
2. SCIM for create/update/deactivate
3. org/product access management via Atlassian admin APIs and policies
4. browser automation only for low-frequency admin UI tasks or UI-only edge cases

Implication for OpenSidebar:

- Jira should default to **do not automate in browser if Guard/SCIM/admin API is available**.
- A browser agent can still assist with audits, exceptions, or UI-only admin workflows, but it should not be the primary provisioning layer.

### Figma

Official Figma help documents cover:

- adding members or guests to an organization
- SAML SSO
- SCIM-based provisioning
- license management via SCIM

Figma therefore also has a real identity-managed path, even if its broader public API story is less provisioning-centric than Atlassian's.

The best-practice order is:

1. SAML SSO where applicable
2. SCIM for member lifecycle and license governance
3. manual org invite flow for exceptions

Implication for OpenSidebar:

- Browser automation is more plausible here than in Jira if the task is specifically an admin UI action.
- It is still not the preferred default when SCIM is available.
- Billing and seat-management side effects make verification and approval more important.

---

## What "State of the Art" Actually Means Here

For this specific problem, SOTA is not "the smartest browser agent." It is:

1. **Identity-first architecture**
   Use the enterprise identity stack before touching the browser.

2. **Separation of concerns**
   Authentication, provisioning, and authorization should be split:
   - SAML/OIDC for login
   - SCIM for user lifecycle
   - product admin flows for app-specific placement and exceptions

3. **Policy-driven exceptions**
   Manual or browser-based flows are reserved for cases where:
   - SCIM is unavailable
   - plan tier does not support it
   - the task is one-off
   - the operation is app-specific and not exposed via API

4. **Post-action verification**
   Success should mean more than "the dialog closed":
   - user appears in the people/members list
   - role or license is correct
   - status is not pending in an unexpected way

---

## OpenSidebar Implications

OpenSidebar's current architecture is an executor/verifier browser agent, not an enterprise IAM plane. That matters.

From [docs/architecture/overview.md](../../docs/architecture/overview.md), OpenSidebar is designed around:

- page perception
- DOM interaction
- multi-step orchestration
- verification and tracing

That makes it suitable for **last-mile admin UI execution**, not for replacing SCIM or an IdP.

### Recommended Runtime Policy

If OpenSidebar handles a request like "create a user in Notion, Jira, and Figma", the runtime should:

1. detect whether SCIM or admin APIs are available
2. prefer those paths conceptually
3. only proceed with browser automation when:
   - the operator explicitly allows it
   - the operation is UI-only or exception-only
   - verification criteria are defined

### Recommended Skill Shape

This should be implemented as a gated workflow skill, something like:

```yaml
skill: enterprise-user-provisioning
requires_admin_context: true
api_or_scim_preferred: true
browser_fallback_only: true
verification_required: true
human_approval_recommended: true
```

### Recommended Verification Contract

For any browser-executed provisioning step, verify:

1. target email appears in the relevant people/member list
2. expected role/license/seat is shown
3. product-specific invite state is captured if surfaced
4. trace includes enough evidence for audit review

---

## Decision Summary

If the goal is "manage creating a user in all three places", the state-of-the-art answer is:

- **Jira/Atlassian:** SCIM/admin API first. Browser fallback only for exceptions.
- **Notion:** SCIM + SAML/JIT when available. Browser fallback for manual admin flows.
- **Figma:** SCIM + SAML where available. Browser fallback is acceptable for exception paths, but still second-best to identity-managed provisioning.

So the SOTA pattern is not "one browser agent that clicks through all three apps." The SOTA pattern is:

- infrastructure-first where possible
- browser-agent fallback where necessary
- strict verification and auditability throughout

---

## Primary Sources

- Notion SCIM: https://www.notion.com/help/provision-users-and-groups-with-scim
- Notion SAML / JIT: https://www.notion.com/help/saml-sso-configuration
- Atlassian user provisioning: https://support.atlassian.com/provisioning-users/docs/configure-user-provisioning-with-google-cloud/
- Atlassian User Provisioning REST API: https://developer.atlassian.com/cloud/admin/user-provisioning/rest/
- Atlassian Organizations REST API: https://developer.atlassian.com/cloud/admin/organization/rest/intro/
- Figma add members or guests: https://help.figma.com/hc/en-us/articles/360040453113-Add-members-or-guests-to-an-organization
- Figma SAML SSO guide: https://help.figma.com/hc/en-us/articles/360040532333-SAML-SSO-guide
- Figma manage licenses via SCIM: https://help.figma.com/hc/en-us/articles/360048787534-Manage-licenses-via-SCIM

