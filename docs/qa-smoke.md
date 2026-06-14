# QA Smoke Scenarios

Use these checks for the critical BestBudget flows until browser E2E tests are
introduced.

## Automated Checks

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

## Manual Smoke

Prerequisite: start the app through Docker as described in `README.md`, then
open `http://localhost:5173`. Use a fresh browser profile or clear
`localStorage` key `bestbudget.app.v1`.

1. Register a new account with a valid name, email, and a 6+ character password.
   Verify the app opens settings and shows the account email.
2. Create a shared RUB workspace. Verify the overview opens, the workspace name
   is visible in the shell, and preset categories are listed.
3. Add an income transaction, then an expense transaction. Verify the
   transactions list shows both rows with correct signed amounts and the
   overview balance equals income minus expense.
4. Add a category budget for the expense category. Verify the budgets screen
   shows spent amount, limit, and percent progress.
5. Add a liability with a future next-payment date. Verify it appears in
   Credits and in the calendar payment list for that date.
6. Upload a document record with a small PDF or image. Verify the documents
   screen shows title, filename, linked target, and uploaded status.
7. Invite a family member by email. Verify the family screen shows the invited
   member with invitation status.
8. Search by transaction title, category, amount, and account. Verify matching
   rows remain and unrelated rows are filtered out.
9. Log out, then log in again. Verify the selected workspace and all created
   records are restored from browser storage.
10. Create a second workspace and switch between workspaces. Verify operations,
    budgets, liabilities, documents, and members stay scoped to the selected
    workspace.
11. Open Settings, then configure SSO for the selected workspace. Verify
    Keycloak/authentik/OIDC choices, issuer URL, client ID, scopes, RBAC claim,
    default role, and role mapping fields can be saved.
12. Log out and verify the auth screen shows local login, registration, demo,
    and SSO entry points. With a real IdP configured, clicking SSO should start
    an Authorization Code + PKCE redirect. Without a reachable IdP, the app
    should show an error toast and keep the local session unchanged.
13. In Family, verify the current role and RBAC badges are visible. Observer
    users should see disabled create/invite/upload actions; member users should
    be blocked from member and SSO management.
