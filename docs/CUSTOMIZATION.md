# Make Agent4 yours

Agent4 is a template for your company, not a fixed list of someone else's preferences.

## Choose your tools

Open **Team access → Customize this workspace** as the owner. Rename the workspace and turn Canvas, Clients, Tasks, Meetings, Money, Paperwork, and Sites on or off. Save to update navigation and search. Everyone in this installation shares these choices; other open browsers pick them up when refreshed.

Turning a tool off preserves its data. Turning Sites off also stops its scheduled monitoring loop. A request already in progress may finish. Module switches organize the UI; existing API permissions still apply. Use owner/member access controls for privacy.

Home, account management, and the assistant remain available so you can always return to settings and restore a tool. The default module list is in `src/settings-store.js`; the shared navigation registry is in `hq/src/places.js`.

## Branding and documents

- Change the workspace name in settings.
- Enter your own invoice company details, tax labels, payment details, and currency units in **Money → invoices → company profile**. Blank fields contain no previous company's details.
- Edit document templates in `hq/src/paperwork-templates.js` and sheet templates in `hq/src/sheet-templates.js`.
- Replace the original Agent4 falcon in `hq/src/assets/falcon.svg`, `public/favicon.svg`, and `hq/public/favicon.svg`. Client page assets are under `src/public-assets/`. Keep your version of all copies consistent.
- Edit `hq/src/styles/` to change colors, layout and typography. Use `npm run hq:build` after source changes, or rerun the Docker installer.

Client-facing pages use a neutral Agent4 mark and “Your company” template wording. If you enable these pages, adapt that wording in `src/client-page.js` for your business. They ship without the private product's logos, pictures or fonts.

## Add a tool

Add its data/API behavior under `src/`, a React component under `hq/src/components/`, an entry in `MODULES` and the navigation registry, then render it from `hq/src/App.jsx`. Validate inputs on the server and enforce access there. Reuse the authenticated request flow so mutations carry a session CSRF token.

Keep external requests opt-in. Explain what data the integration reads, where it sends data, how to turn it off, and how credentials are stored. Do not add live service credentials, personal data, or your deployment's domains to examples or tests.

## Keep updates manageable

Use `.env` for service credentials and deployment choices. Keep private infra and independent services in a separate private repository. Prefer module switches and public configuration over deleting core files. Contribute reusable fixes to this public core, then update your own deployment to a tested public commit. The [architecture guide](ARCHITECTURE.md) describes this shared-core workflow.
