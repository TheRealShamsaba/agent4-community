# Security

Agent4 is an early self-hosted community project. Run a patched release behind HTTPS when sharing it beyond localhost, keep host access restricted, and keep private off-host backups.

## Report a vulnerability

Use [GitHub's private vulnerability reporting](https://github.com/TheRealShamsaba/agent4-community/security/advisories/new). Do not include credentials, customer data, private documents, or live invitation/setup links in a public issue. If private reporting is unavailable, open an issue requesting a private reporting channel without exploit details or sensitive data.

There is no paid support commitment or guaranteed response time. Verified fixes should describe the affected behavior, remedy and upgrade path without exposing an installation's private information.

## Security boundaries

- First-owner setup requires a random host-generated key and closes permanently once an account exists.
- Team registration requires an owner-issued, expiring, single-use invitation. Pending invitations can be revoked.
- New password hashes use versioned scrypt with N=131072, r=8, p=1; legacy preview hashes upgrade on successful login. [Parameter guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Session and invitation bearer tokens are stored hashed. Browser sessions use HttpOnly and SameSite=Strict cookies, plus Secure cookies for configured HTTPS origins.
- Unsafe browser requests require the exact configured Origin and the session's CSRF token.
- Login throttling persists in SQLite across restarts. Local host-side recovery revokes account sessions.
- Proxy headers are untrusted by default. Authentication cannot be disabled through configuration.
- Shared team records, personal records and owner-only records have separate server access checks. Module switches are UI preferences, not authorization controls.
- Optional public inquiries, client share pages, monitoring and external connections are explicit features. Turn on only the ones you intend to use.

The public repository excludes runtime databases, secrets, private audits, production infra, company records and company assets. Dependency audits and secret scanners reduce accidental mistakes; they do not replace review of new features and data boundaries.
