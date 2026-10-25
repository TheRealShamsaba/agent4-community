# Changelog

## Unreleased

- Keep private chat drafts, meeting drafts and recoverable recordings isolated when accounts share a browser.

- Raise password hashing to the current scrypt baseline and upgrade earlier preview hashes on successful login.
- Make password verification and session creation atomic with respect to password recovery.
- Use cryptographic recording identifiers, constant log format strings, and exact email-domain checks.

## 0.1.0 — Community preview

- Introduce Agent4 with an original falcon identity and a clean, empty workspace.
- Bring the current shared Clients, projects, tasks, files, meetings, money, paperwork, monitoring and assistant interface to the community edition.
- Add protected first-owner setup, safe invitations, invitation revocation, account recovery and persistent login throttling.
- Add saved workspace naming and module choices; restore an optional notes Canvas without deleting retained work when hidden.
- Add a localhost-first Docker installer, native setup, private backups and non-overwriting restore tooling.
- Document self-hosting, customization, optional connections and a public-core/private-deployment workflow.
- Add public-source checks, Gitleaks scanning, dependency audits, API/security coverage and clean-install CI.
