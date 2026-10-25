# Host Agent4

The easiest first installation is `./agent4.sh`. It needs Docker with Compose v2 and does not need Node on the host. Start with a laptop; move to a server when your team needs access from elsewhere.

## What is stored where

| Location | Contents | Commit or share? |
| --- | --- | --- |
| Source tree | Application code, templates, configuration examples | Yes, after review |
| `.env` | Your deployment choices and optional service credentials | No |
| `.secrets/setup-token` | Random key for claiming the first owner | No |
| Docker volume `<project>_agent4-data` | SQLite database, documents, meeting audio, backups | No |
| `public/hq.html` | Built frontend; separate from the data volume | Generated |

The default Compose project is `agent4`. Use `docker compose -p another-name ...` for a separate installation with its own volume. Reusing a project reuses its existing accounts and data.

Start with 2 CPU cores, 2 GB RAM and sufficient disk for documents and audio. Image compilation needs additional temporary memory and disk. Local AI and transcription need their own resources and are optional; these are starting estimates, not performance guarantees.

## First owner

The installer creates a cryptographically random key in `.secrets/`, which is a private directory on the host. Only someone with that key can create the first owner. The setup link carries it after `#`, so it is not sent in page requests or referrers. The app sends it in a same-origin setup request when you submit the form.

After an owner exists, the database permanently closes setup, including after restarts or if the key remains mounted. The Docker secret is read-only, so its host file can still contain the original key. You can empty it after completing setup:

```sh
: > .secrets/setup-token
```

Keep the file present for Compose. A later installer run may generate another key; it cannot replace an existing owner or reopen registration. Native setup can clear its writable key file automatically.

If the setup page has no key, use the private link printed by `./agent4.sh` or `npm run setup`. Do not open signup to solve a missing key.

## HTTPS for a remote team

Keep the default localhost binding and put a reverse proxy on the same server. Point a DNS name you control at that server. Edit `.env`:

```dotenv
AGENT4_PUBLIC_URL=https://workspace.example.com
AGENT4_TRUST_PROXY=true
```

Use your actual domain. A minimal Caddy configuration is:

```caddyfile
workspace.example.com {
    reverse_proxy 127.0.0.1:8782 {
        header_up X-Real-IP {remote_host}
        header_up -X-Forwarded-Host
    }
}
```

The proxy must overwrite client-supplied identity headers. Only opt into `AGENT4_TRUST_PROXY` with a proxy you control. Keep port 8782 closed on public interfaces. Allow public ports 80 and 443 for the proxy and its certificate provisioning. If the proxy runs in another container, use a private Docker network and its service name instead of `127.0.0.1`.

Then rerun `./agent4.sh`. HTTPS public URLs enable Secure session cookies. The application validates full request origins against `AGENT4_PUBLIC_URL`; it does not build invitations from a caller's Host header. Wrong URL/port settings usually cause a cross-origin error—fix `.env` and recreate the service.

Do not put a workspace under a URL subpath. Use a dedicated origin. Client-facing share pages use a **different hostname**; see [integrations](INTEGRATIONS.md).

## Team accounts and recovery

In **Team access**, the owner creates private invitation links. No mail server is required. Share a link directly with its intended teammate; possession of that link permits creating the specified account. Reissuing an invite invalidates previous unaccepted links for that email. Pending invites can be revoked under workspace customization.

Passwords must be 12–200 characters and are hashed with scrypt. Session cookies are HttpOnly and SameSite=Strict. State-changing browser requests require the configured Origin and a per-session CSRF token. The first owner cannot remove themselves. Removing a teammate revokes their sessions; reinviting a removed member preserves their identity and assignment history.

Forgotten password:

```sh
./agent4.sh reset-password
```

Enter the account's email in the host terminal. A new random password is printed once; save it and then change it in Account settings. Recovery revokes that account's sessions. Host access is administrative access—there is no remote recovery backdoor or email-reset service.

For a native installation: `npm run reset-password`.

## Backups and restores

A useful backup contains both the SQLite database and its uploaded files. Copying only the database loses documents and audio.

```sh
./agent4.sh backup
docker compose cp agent4:/app/data/backups ./backups
```

The wrapper briefly stops the server, runs the snapshot/file copy against its volume, then starts the server again. It restarts the service if backup creation fails. Each backup is a new directory containing `agent4.sqlite`, `files/`, and `meeting-audio/` when present. It excludes `.env` and installation keys. Keep environment credentials separately in a password manager and copy backups to private storage outside the server.

For native installs, stop the server before `npm run backup`; start it again afterward.

To rehearse a restore without touching your current installation, use a **new Compose project** with a new data volume. The restore script refuses to overwrite an existing database:

```sh
# Replace the path with one specific backup directory on your host.
docker compose -p agent4-restored run --rm --no-deps \
  -v /absolute/path/to/backup:/restore:ro \
  agent4 node scripts/restore.js /restore
```

Use a separate source checkout for this rehearsal. Copy `.env.example` to `.env`, set `AGENT4_HOST_PORT=8783` and `AGENT4_PUBLIC_URL=http://localhost:8783`, and create the `.secrets/setup-token` file (an empty file is enough for a restored workspace). The backup directory must be readable by the container's `node` user. Build the image first with `docker compose build`, then run the restore command above. Do not start the new service before restoring, because startup creates its database.

```sh
docker compose -p agent4-restored up -d --wait
```

Sign in with the restored account credentials. Confirm your tasks, files, module settings and meeting notes. The restore is an existing workspace; the installation key cannot replace its owner. Do not remove the original volume until you have verified recovery and retained an off-host backup.

## Updates

Back up first. Read [CHANGELOG.md](../CHANGELOG.md), then:

```sh
git pull --ff-only
./agent4.sh
```

SQLite schema additions are applied on startup. Built frontend files live in the image, so an old data volume cannot pin an old frontend. Data and module settings survive rebuilds. A source downgrade is not a database rollback; restore the matching backup into a new volume if a migration needs to be reversed.

## Troubleshooting

- **Docker cannot connect:** start Docker Desktop or the Docker Engine service.
- **Port already in use:** change `AGENT4_HOST_PORT` and `AGENT4_PUBLIC_URL` together in `.env`.
- **Cross-origin request rejected:** use the exact configured URL, including scheme and port; recreate the service after editing `.env`.
- **Setup already completed:** sign in with the original owner or use host-side password recovery.
- **No model is ready:** core tools still work. Connect Ollama or a hosted provider only when needed.
- **A tool disappeared:** the owner can enable it in Team access → Customize this workspace. Its saved data remains.
- **More detail:** `docker compose ps` and `docker compose logs --tail=100 agent4`. Redact credentials and personal data before sharing logs.
