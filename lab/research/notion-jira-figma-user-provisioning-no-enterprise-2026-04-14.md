# Research Note: User Provisioning Without Enterprise Access

**Date:** 2026-04-14
**Researcher:** OpenSidebar Lab
**Scope:** Best practice for creating and managing users in Notion, Jira Cloud, and Figma when Enterprise-only identity features are unavailable or intentionally out of scope
**Evidence grade:** D for architecture recommendations; vendor-doc backed for platform capability summary

## Executive Summary

Without enterprise access, the state of the art changes materially.

You should assume:

- no SCIM-based lifecycle automation
- no enterprise identity governance as the primary control plane
- admin UI invites are the main operational path
- browser automation can be a legitimate execution layer, but only with strong verification and billing awareness

In this non-enterprise setting, OpenSidebar is more useful than in the enterprise case, because the browser often becomes the only realistic automation surface.

The best-practice order becomes:

1. use built-in admin invite flows
2. automate those flows carefully through the browser when worthwhile
3. verify membership and role state after the action
4. preserve an audit trail because the product UI is now the system of record

---

## Capability Snapshot Without Enterprise Assumptions

| Product | Primary Non-Enterprise Path | Main Constraint | Browser-Automation Fit |
| --- | --- | --- | --- |
| Notion | Workspace member or guest invites | Seat/billing implications for members | Good |
| Jira Cloud | Site/org admin invite + product access assignment | Billing and access assignment can diverge | Medium |
| Figma | Team/workspace invites, plus lower-tier seat handling | Plan features differ sharply between team vs org surfaces | Good |

---

## Product Findings

### Notion

Without Enterprise SCIM, Notion falls back to normal collaboration and workspace membership flows.

Important practical points from Notion help:

- adding a **member** to a paid workspace is a billable action
- inviting a **guest** to a page can avoid a paid member seat depending on plan limits
- Notion distinguishes clearly between member-level access and page-level guest access

This means the real provisioning question in Notion is often not "create a user", but:

- should this person be a **workspace member**
- or should they be a **guest on specific content**

That distinction matters because it directly affects cost and permissions.

For OpenSidebar, Notion is a strong candidate for browser automation in the non-enterprise case because:

- the invite flows are conceptually simple
- the success criteria are visible in the product UI
- the main risk is not technical fragility but **incorrect access class** and **avoidable seat cost**

Recommended OpenSidebar policy:

1. ask or infer whether the user should be a member or guest
2. prefer guest invite when the task does not require full workspace membership
3. verify that the invited email appears in the correct place afterward

### Jira Cloud

Without Atlassian Guard Standard and SCIM-style provisioning, Jira Cloud user management becomes an admin-console workflow:

- invite users
- grant product access
- assign site or project permissions

This is workable, but it is less clean than enterprise provisioning because identity lifecycle and product access are no longer centrally managed.

The main operational issue in Jira is that "invited" does not fully equal "usable":

- the user may exist in an invited or pending state
- product access may need separate confirmation
- permission assignment may happen at more than one layer

For OpenSidebar, Jira is still automatable, but it needs more explicit verification than Notion:

1. confirm the email was added
2. confirm the intended product access is granted
3. confirm the user appears in the right people/admin view

So Jira is a **medium-fit browser automation target** in the non-enterprise case:

- feasible
- useful
- but more stateful and error-prone than Notion

### Figma

Without Enterprise SCIM, Figma should be approached through its standard collaboration/admin surfaces.

The biggest distinction in Figma is between:

- organization-level member management, which is plan-sensitive
- normal collaboration invitations to teams, projects, and files

Figma’s own help documents make clear that:

- organization-wide member management features are tied to Organization and Enterprise plans
- inviting collaborators to teams, projects, or files remains a core path
- invited users can have seat implications depending on plan and permission choice

So for a non-enterprise customer, the dominant real-world path is usually:

- invite to a team/project/file
- choose the minimal necessary seat/permission level
- verify the collaborator appears in the right resource

For OpenSidebar, Figma is a good browser-automation candidate in the non-enterprise case because:

- collaboration invites are highly UI-driven
- the task is local to the product
- there is often no better automation surface available

The main risk is not "can the browser click this" but:

- choosing the wrong seat type
- triggering unintended billing or edit access
- confusing team-level invites with broader admin actions

---

## What "SOTA" Means When Enterprise Features Are Missing

In this scenario, state of the art is not "replace IAM with an agent."

It is:

1. **UI-first operational discipline**
   Treat the product admin UI as the authoritative control plane.

2. **Access-minimizing invites**
   Default to the narrowest permission that satisfies the request.

3. **Billing-aware automation**
   The system should know that some invite actions can create paid seats or additional billed access.

4. **Verification after mutation**
   The agent must not stop at clicking `Invite`.
   It should verify the resulting state in the people/member/collaborator surface.

5. **Exception handling instead of false certainty**
   If the product shows a pending state, duplicate user warning, domain restriction, or billing gate, the run should stop and surface that fact explicitly.

---

## OpenSidebar Implications

OpenSidebar is well-suited to this non-enterprise case because its architecture is already built around:

- multi-step browser workflows
- verification after action
- trace capture
- reusable workflow skills

See [docs/architecture/overview.md](../../docs/architecture/overview.md).

### Recommended Skill Shape

The right abstraction is not a generic "create user" command.

It is a gated workflow skill like:

```yaml
skill: non-enterprise-user-provisioning
requires_admin_context: true
identity-infra-assumed: false
browser-primary: true
verification_required: true
billing-sensitive: true
```

### Recommended Runtime Behavior

For a request like "create this user in Notion, Jira, and Figma", the runtime should:

1. split by product
2. load product-specific website memory
3. choose the right non-enterprise pattern:
   - Notion: member vs guest invite
   - Jira: invite + product access + permission confirmation
   - Figma: collaborator/team/workspace invite with minimal seat level
4. execute with act-check-act discipline
5. verify resulting state before completion

### Recommended Verification Contract

The browser agent should only mark success if it can confirm:

- the target email is present in the relevant member/collaborator surface
- the expected role or access class is shown
- no visible warning indicates pending correction, billing confirmation, or duplicate-user conflict

---

## Practical Recommendations by Product

### Notion

- Prefer guest invites unless full workspace membership is explicitly needed.
- Treat member invites as billing-sensitive.
- Verify whether the email was added as guest vs member, not just whether the modal closed.

### Jira Cloud

- Separate "invite the person" from "grant the right product access".
- Expect more than one verification step.
- Surface ambiguous invited/pending states instead of assuming completion.

### Figma

- Prefer the narrowest collaboration scope that satisfies the request.
- Distinguish team/project/file invite from broader admin/member actions.
- Treat seat selection as approval-sensitive.

---

## Bottom Line

Without enterprise access, browser automation moves from a fallback to a first-class operational option.

That does **not** mean the problem becomes trivial.

It means the correct OpenSidebar posture is:

- browser-first execution
- verification-first completion logic
- billing-aware guardrails
- site-specific memory and skills

So the updated answer is:

- **Enterprise case:** identity infrastructure first, browser fallback second
- **Non-enterprise case:** admin UI first, browser agent becomes the practical automation layer

---

## Primary Sources

- Notion billing, members, guests: https://www.notion.com/help/members-and-billing
- Notion sharing/invites: https://www.notion.com/help/share-your-work
- Atlassian user provisioning overview: https://support.atlassian.com/provisioning-users/docs/configure-user-provisioning-with-google-cloud/
- Atlassian organization admin API overview: https://developer.atlassian.com/cloud/admin/organization/rest/intro/
- Figma organization invites: https://help.figma.com/hc/en-us/articles/360040453113-Add-members-or-guests-to-an-organization
- Figma seat and billing update notes: https://help.figma.com/hc/en-us/articles/27468498501527-Updates-to-Figma-s-pricing-seats-and-billing-experience

