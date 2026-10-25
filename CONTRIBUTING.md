# Contribute to Agent4

Help people build their first company with fewer tools to pay for and maintain. Clearer setup, accessible interfaces, thoughtful defaults, good documentation and reliable small features all count.

## Run locally

Use Node 24 LTS (or Node 22.13+ on the 22.x line):

```sh
npm ci
npm --prefix hq ci
npm run hq:build
npm run setup
npm start
```

For frontend development, keep the API server running on localhost:8782 and run `npm run dev` in another terminal. Vite proxies the API to that server. Use the dev server's printed URL, with `AGENT4_PUBLIC_URL` set to that origin in `.env`, and restart the API if you change it.

## Before opening a pull request

```sh
npm run verify
npm audit
npm --prefix hq audit
npm run sbom
```

Stage the intended public files and run `npm run security:secrets` with Gitleaks installed, or Docker running. This checks history and exactly the staged source, without exporting your ignored local environment or runtime data. Never attach those files to an issue.

Explain the user-visible problem, your change and meaningful validation. Add tests for access boundaries, persistence, migrations and behavior that can regress. A spelling fix does not need a test. Keep changes focused and use descriptive commits.

Use fictional companies, `example.com` / `.example` domains, reserved example phone numbers, and synthetic account IDs. Screenshots must come from a fresh local workspace containing only fictional data. Do not import customer data, private deployment code, original company assets, tokens, personal account IDs, or private Git history.

## Public core and private preferences

Read [the architecture guide](docs/ARCHITECTURE.md). Shared capabilities live here; deployment-specific settings and independent company services stay private. Module switches let a team remove tools from its daily UI without deleting code or data.

Contributions are provided under [AGPL-3.0-only](LICENSE). Keep the license and third-party attribution. Follow the [code of conduct](CODE_OF_CONDUCT.md). Report vulnerabilities using [SECURITY.md](SECURITY.md), not a public reproduction containing private information.
