# Aurens Mail

Private webmail for `aurens.app`, hosted on a single Ubuntu VPS. It receives internet mail with Postfix, supports authenticated compose and reply through a restricted outbound SMTP path, stores searchable metadata in PostgreSQL, stores private message objects in MinIO, and serves an authenticated React inbox through Nginx.

No forwarding provider, public object bucket, or Cloudflare service is used.

This repository is configured for `aurens.app`, but it works for any domain: change `EMAIL_DOMAIN`, `APP_ORIGIN`, and `OWNER_EMAIL` in `.env`, substitute your own domain in the DNS, Nginx, and Postfix steps below, and generate your own DKIM key.

## Architecture

```text
Internet sender
     │ SMTP :25
     ▼
Postfix (public MTA, queue, STARTTLS, relay protection)
     │ SMTP 127.0.0.1:2525
     ▼
Aurens ingestion service ── MIME parser ── HTML sanitizer
     │                         │
     ├── PostgreSQL            └── private MinIO objects
     │   metadata/search           raw .eml, text, HTML, attachments
     │
     └── authenticated REST API :3100
                         ▲
Nginx + HTTPS ── React webmail at mail.aurens.app
```

Postfix is the only mail-facing process. The application and object storage listen only on the Docker/private loopback networks. If ingestion is temporarily unavailable, Postfix queues and retries instead of losing accepted mail.

## Features

- Dedicated and catch-all application mailboxes
- Authenticated compose/reply, selectable sender mailbox, Sent folder, and outbound rate limiting
- Full MIME parsing, multipart bodies, Unicode headers, inline files, and attachments
- Original `.eml`, text, sanitized HTML, and attachment preservation
- Searchable sender, recipient, mailbox, subject, preview, date, read/starred, and attachment filters
- Cursor pagination, unread counts, spam, trash, restore, permanent delete, and `.eml` export
- Owner/admin/member roles with per-member mailbox assignments
- Scrypt passwords, random hashed sessions, `HttpOnly`/`SameSite=Strict` cookies, CSRF origin checks, API rate limits, and consistent JSON errors
- Strict HTML allowlist, script/form/iframe/event removal, dangerous URL removal, blocked remote images, and sandboxed iframe rendering
- Attachment path normalization, executable warnings, size/count limits, duplicate Message-ID handling, sender allow/block rules, and partial-object cleanup
- Automatic 30-day trash/spam cleanup, orphan object cleanup, database/object backup script, and structured logs without message contents

This includes basic abuse controls; it is not a replacement for a commercial spam-classification service. The `sender_rules` table and spam folder are extension points for SpamAssassin, Rspamd, or an external scorer.

## Project layout

```text
apps/
  api/                 Fastify REST API and internal SMTP ingestion
  web/                 React + TypeScript inbox
packages/
  shared/              Zod request schemas and shared types
migrations/            PostgreSQL schema
deploy/                 Nginx and Postfix reference configuration
scripts/                Postfix setup and backups
docker-compose.yml      PostgreSQL, MinIO, and application
Dockerfile              Reproducible production image
```

## DNS at Name.com

Keep the existing website records. Add only:

| Type | Host | Answer | TTL | Priority |
|---|---|---|---:|---:|
| A | `mail` | `YOUR_VPS_IP` | 300 | — |
| MX | blank | `mail.aurens.app` | 300 | 10 |

Verify:

```bash
dig +short A mail.aurens.app @1.1.1.1
dig +short MX aurens.app @1.1.1.1
```

SPF, DKIM, DMARC, reverse DNS, and an outbound SMTP route are required before enabling sending. Keep `OUTBOUND_ENABLED=false` until those controls are configured and a live delivery test succeeds.

## Local development

Requirements: Node 22+, Docker, and Docker Compose.

```bash
cp .env.example .env
# Replace every change-me value and OWNER_PASSWORD.
docker compose up -d postgres minio
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

The web app runs at `http://localhost:5173`; the API runs at `http://127.0.0.1:3100`. Send a local fixture through the ingestion SMTP server with a tool such as `swaks`:

```bash
swaks --server 127.0.0.1:2525 --from test@example.com --to support@aurens.app --data apps/api/test/fixtures/plain.eml
```

## Production deployment

These are the reproducible steps used for the VPS deployment.

### 1. Install runtime packages

```bash
apt-get update
apt-get install -y ca-certificates curl nginx certbot python3-certbot-nginx ufw
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
```

### 2. Configure application secrets

Place the repository at `/opt/aurens-mail`, then create `/opt/aurens-mail/.env` with mode `600`. Start from `.env.example` and use long random values for `POSTGRES_PASSWORD`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, and `OWNER_PASSWORD`.

Production-specific values:

```dotenv
NODE_ENV=production
HTTP_HOST=0.0.0.0
HTTP_PORT=3100
SMTP_HOST=0.0.0.0
SMTP_PORT=2525
EMAIL_DOMAIN=aurens.app
APP_ORIGIN=https://mail.aurens.app
COOKIE_SECURE=true
OWNER_EMAIL=admin@aurens.app
OUTBOUND_ENABLED=false
OUTBOUND_SMTP_HOST=host.docker.internal
OUTBOUND_SMTP_PORT=2587
```

The Docker Compose network overrides `DATABASE_URL` and S3 connection values internally. Do not commit `.env`.

### 3. Build and start

```bash
cd /opt/aurens-mail
docker compose build --pull
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:3100/health
```

Migrations, the private MinIO bucket, the owner account, and initial `pa`, `support`, `admin`, and catch-all mailboxes are created idempotently at startup.

### 4. Add Nginx without changing the website

```bash
cp deploy/nginx-mail.conf /etc/nginx/sites-available/aurens-mail
ln -s /etc/nginx/sites-available/aurens-mail /etc/nginx/sites-enabled/aurens-mail
nginx -t
systemctl reload nginx
certbot --nginx -d mail.aurens.app --redirect --non-interactive --agree-tos -m OWNER_EMAIL_HERE
```

The separate `server_name mail.aurens.app` block does not replace the existing `aurens.app`/`www.aurens.app` configuration.

### 5. Configure inbound SMTP

After the application health check succeeds:

```bash
chmod +x scripts/configure-postfix.sh
EMAIL_DOMAIN=aurens.app scripts/configure-postfix.sh
postconf -e 'smtpd_tls_security_level = may'
postconf -e 'smtpd_tls_cert_file = /etc/letsencrypt/live/mail.aurens.app/fullchain.pem'
postconf -e 'smtpd_tls_key_file = /etc/letsencrypt/live/mail.aurens.app/privkey.pem'
postfix check
systemctl reload postfix
ufw allow 25/tcp comment 'Inbound SMTP'
```

The public listener accepts only `aurens.app` recipients and is not an open relay. Outbound application traffic must use a Docker-private trusted path or an authenticated SMTP relay; never expose unauthenticated submission publicly.

### 6. Test delivery

Check SMTP externally:

```bash
openssl s_client -starttls smtp -connect mail.aurens.app:25 -servername mail.aurens.app
```

Then send a message from an unrelated provider to `support@aurens.app` and follow logs:

```bash
journalctl -u postfix -f
docker compose logs -f --tail=100 app
```

Open `https://mail.aurens.app`, sign in with `OWNER_EMAIL` and the configured initial password, verify the message, and immediately store the password in a password manager.

## API

All endpoints except login require the private session cookie and enforce mailbox authorization.

```text
POST   /api/auth/login             POST   /api/auth/logout
GET    /api/session
GET    /api/mailboxes              POST   /api/mailboxes
PATCH  /api/mailboxes/:id          DELETE /api/mailboxes/:id
GET    /api/messages               GET    /api/messages/:id
POST   /api/messages/send
PATCH  /api/messages/:id           DELETE /api/messages/:id
GET    /api/messages/:id/raw       GET    /api/attachments/:id/download
GET    /api/search
GET    /api/users                  POST   /api/users
```

Message query parameters: `mailbox`, `folder`, `search`, `unread`, `starred`, `hasAttachment`, `sender`, `recipient`, `dateFrom`, `dateTo`, `cursor`, and `limit`.

Errors have one format:

```json
{ "error": { "code": "MESSAGE_NOT_FOUND", "message": "The requested message was not found." } }
```

## Mailbox and access administration

Owners and admins can create mailboxes from the UI. Members see only entries in `user_mailboxes`. Users can be created with `POST /api/users`; admins may create members, while only owners may create admins or another owner. Disabling a mailbox stops it from resolving. The seeded `catchall@aurens.app` entry receives unknown addresses until it is disabled or another mailbox is made the catch-all.

## Retention and recovery

Trash and spam default to 30 days; inbox retention is indefinite. Change `TRASH_RETENTION_DAYS` and `SPAM_RETENTION_DAYS` in `.env` and restart the app. Cleanup runs every six hours; orphan reconciliation runs daily.

Back up both metadata and objects:

```bash
chmod +x scripts/backup.sh
BACKUP_DIR=/var/backups/aurens-mail scripts/backup.sh
```

Schedule daily with root cron or a systemd timer. Copy backups off the VPS; same-disk backups do not protect against server loss.

Restore PostgreSQL:

```bash
cat database-TIMESTAMP.dump | docker compose exec -T postgres pg_restore -U aurens_mail -d aurens_mail --clean --if-exists
```

Restore the MinIO data volume only while the stack is stopped. Preserve the same MinIO keys and bucket name.

If processing fails, Postfix retains the queued message. Inspect with `postqueue -p`, fix the application, then run `postqueue -f`. The application records content-free failure details in `processing_failures`. It deletes already-written objects when a database transaction fails.

## Operations

```bash
# Application state and logs
docker compose ps
docker compose logs --tail=200 app

# Mail queue and logs
postqueue -p
journalctl -u postfix --since '1 hour ago'

# Validate Nginx and Postfix
nginx -t
postfix check

# Update
git pull --ff-only
docker compose build --pull
docker compose up -d

# Tests and strict build
npm test
npm run typecheck
npm run build
```

Never log or paste raw message bodies, session cookies, `.env`, or MinIO credentials. MinIO has no public port and downloads always flow through an authenticated API.

## Publishing safely

The real `.env`, deployment archives, backups, build output, and TypeScript build metadata are ignored by Git. GitHub Actions verifies linting, types, tests, and the production build on every push and pull request. The repository is safe to publish: it contains no credentials, private keys, or server addresses — only reference configuration and example values.

The repository contains a DKIM public DNS record for convenience. It does not contain the DKIM private key. Never add the corresponding private key, SSH credentials, production passwords, database dumps, or mailbox exports to Git.
