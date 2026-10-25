# Shared core, independent deployments

Agent4 is a Node HTTP server with a React frontend and SQLite persistence. `src/hq-server.js` owns routing and server authorization; domain stores own validated database operations. `hq/src/App.jsx` uses a shared navigation registry and the saved module settings. The frontend build is served from `public/hq.html`, outside persistent user data.

An installation is one trusted team, with an owner and invited members. It is not a multi-tenant hosting platform. Shared clients/tasks/canvas are team data, calendars and meetings are actor-scoped, and money/paperwork/sites/access management are owner-only. Access checks belong on the server even when the UI hides a control.

## Keep personal choices out of the public core

Use the same public core for the community installation and your own company:

1. Land generic feature changes and bug fixes in this repository, with fictional test fixtures.
2. Update your company deployment to a tested commit or release.
3. Put company names, domains, service tokens, provider choices and secrets in private deployment configuration.
4. Use workspace module switches for personal preferences. Hiding Canvas does not require maintaining a separate source fork.
5. Keep truly independent private services behind documented HTTP interfaces. Do not couple them to another program's SQLite tables.

This is a workflow, not an automatic mirror of a private repository. Never copy private history, working directories, data volumes, `.env`, ignored reports, screenshots or deployment scripts into this project. A future feature should be reviewed and ported as source with new fictional fixtures. A blanket copy from a private repository defeats the privacy boundary.

There is no scheduled synchronization or automatic publication. Private deployments remain under their owner's control. License obligations depend on the actual combination and distribution of code; keep the AGPL notice and source offer when applicable.

## Verification

`npm run verify` runs lint, domain/API/security tests, the frontend build, local documentation links, and the public-source guard. `npm run security:secrets` scans reachable history and the staged source with Gitleaks. CI also audits dependencies and builds a clean Docker installation.

`test/community-security.test.js` covers first-owner claims, exact Origin and CSRF checks, single-use/revoked invites, member restrictions, password recovery, restart persistence and retained Canvas data. Generic tests cover the latest shared client, project, task, finance, document, meeting and monitoring behavior.
