# SSO and RBAC Test Scenarios

Use this matrix when the backend SSO and permission layer lands. The current
Vitest coverage exercises the local storage baseline: role normalization,
active-membership workspace selection, and local login edge cases.

## Provider Normalization

| Area | Scenario | Expected result |
| --- | --- | --- |
| OIDC issuer | Google, Apple, and Microsoft discovery metadata are normalized into the configured provider record. | Login only continues for the exact configured issuer, client ID, redirect URI, and response type `code`. |
| OIDC subject | Two users with the same email from different issuers sign in. | Identities remain separate by `issuer + subject`; email alone never links accounts. |
| OIDC email | Provider returns mixed-case email, missing email, or `email_verified=false`. | Stored email is canonical lower case; missing or unverified email follows the configured policy and cannot silently join an existing user. |
| Microsoft tenant | Token is issued by a different tenant than the workspace provider config. | Login fails before user/session creation. |
| SAML NameID | Persistent, email, and transient NameID formats are received. | Persistent IDs are preferred; transient IDs are rejected unless an explicit stable attribute mapping exists. |
| SAML attributes | Role, group, email, name, and locale attributes use provider-specific names. | Attributes are mapped through provider config, trimmed, and normalized before role evaluation. |
| Unsupported provider | Unknown provider key or disabled provider is requested. | Start/callback endpoint returns a provider-not-found error and creates no session. |

## Role Mapping

| Scenario | Expected result |
| --- | --- |
| Config maps IdP group `finance-admins` to `admin`. | User receives `admin` only inside the configured workspace. |
| Config maps IdP group `family-viewers` to `observer`. | User can read permitted workspace data but cannot create, edit, invite, export, or upload. |
| User has multiple mapped groups. | Highest allowed role is selected deterministically from `owner > admin > member > observer`, with audit metadata explaining the source claim. |
| User has no mapped groups. | User receives the configured default role or is denied if no default is configured. |
| Provider sends an unknown role claim such as `superadmin`. | Claim is not promoted; login falls back to default/deny policy and records an audit event. |
| Existing owner role is asserted by IdP for a new user. | Owner assignment requires explicit workspace policy; no silent owner takeover. |
| Existing member is downgraded by IdP mapping. | Session permissions update on next login and existing sessions are refreshed or revoked according to policy. |

## Permission Enforcement

| Action | Owner | Admin | Member | Observer |
| --- | --- | --- | --- | --- |
| View workspace overview and calendar | Allow | Allow | Allow | Allow |
| Create/edit transactions and budgets | Allow | Allow | Allow | Deny |
| Upload and link documents | Allow | Allow | Allow | Deny |
| Download/export financial or document data | Allow | Allow if policy permits | Deny by default | Deny |
| Invite members | Allow | Allow | Deny | Deny |
| Change member roles | Allow | Deny for owner changes | Deny | Deny |
| Remove workspace or transfer ownership | Allow | Deny | Deny | Deny |
| Access another workspace by ID | Deny unless active member | Deny unless active member | Deny unless active member | Deny unless active member |

Each denied action should return a consistent authorization error, avoid partial
state changes, and emit an audit event with user, workspace, action, and reason.

## Login Edge Cases

1. Expired OIDC code, replayed code, missing PKCE verifier, mismatched `state`,
   or mismatched `nonce` fails before identity linking.
2. SAML assertion with expired `NotOnOrAfter`, mismatched audience, invalid
   signature, or replayed assertion ID fails before identity linking.
3. Login for an invited-but-not-active membership creates a user session only
   when product policy allows it, but never selects the invited workspace as
   active.
4. Deactivated user, disabled provider, deleted workspace, or removed
   membership cannot create a usable workspace session.
5. Provider email change updates profile fields only after identity is matched
   by stable provider key.
6. Local fallback login keeps existing behavior: email is trimmed and
   case-normalized, unknown account returns not-found, wrong password returns
   invalid-password, and no workspace is selected for invited-only members.

## Unit Test Candidates

1. Provider normalizers: canonical provider key, issuer, subject, email,
   verified-email policy, and SAML attribute aliases.
2. Role mapper: explicit mapping, multiple-claim precedence, unknown-claim
   fallback, default role, and deny-without-default.
3. Permission helper: action matrix for every role and cross-workspace denial.
4. Session creator: active membership required for `activeWorkspaceId`,
   invited-only membership behavior, deleted workspace fallback, and audit
   payload shape.
