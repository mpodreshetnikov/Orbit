# Self-Hosting Orbit

This guide puts Orbit on a server you rent, under a domain you own, with one command. It is written
for someone who has never run a server before; every step says what to type and what you should
see. If you are an AI agent doing this for someone, read [For agents](#for-agents) first.

What you end up with: Orbit at `https://<your domain>`, with a real HTTPS certificate, Google
sign-in limited to the e-mails you list, uploads, reminders and the AI features — the same app as
the hosted version, running entirely on your machine.

## What runs where

Everything lives on one server, in Docker containers that `deploy/orbit` starts and looks after:

- **Caddy** answers on ports 80 and 443, gets the HTTPS certificate from Let's Encrypt by itself,
  and sends each request to the right place.
- **web** is the Orbit app (Next.js).
- **Supabase** is the backend: Postgres (the database), Auth (Google sign-in), Storage (uploaded
  files), Realtime, PostgREST and the Edge Functions. It is the official
  [self-hosted Supabase](https://supabase.com/docs/guides/self-hosting/docker) release, pinned in
  `deploy/supabase-upstream.env`; `deploy/orbit` downloads it and layers Orbit's settings
  (`deploy/docker-compose.yml`) on top.

The only file you edit is `deploy/.env`. Your data (database, files, certificates) is in
`/var/lib/orbit`.

## Step 1 — Get a server and a domain

**Server.** Any Linux virtual server ("VPS") with:

- 2 CPU cores, **4 GB RAM**, 40 GB disk (about $5–10 a month at most providers);
- Ubuntu 24.04 or Debian 12;
- a public IPv4 address, and ports 80 and 443 open.

**Domain.** Any domain or subdomain, e.g. `orbit.example.com`. In your domain registrar's DNS
settings create an **A record**: name `orbit` (or whatever you chose), value = your server's IP
address. It can take from a minute to an hour to start working; check with `ping orbit.example.com`
— it should show your server's IP.

## Step 2 — Prepare the server

Connect to the server (`ssh root@<server ip>`) and run, one line at a time:

    apt update && apt install -y git curl openssl
    curl -fsSL https://get.docker.com | sh
    git clone https://github.com/mpodreshetnikov/Orbit.git /opt/orbit
    cd /opt/orbit

`docker --version` should now print a version, and you are inside the Orbit folder.

## Step 3 — Fill in the settings

    cp deploy/.env.example deploy/.env
    nano deploy/.env

Every setting has a comment above it saying what it is and where to get it. You must replace each
`CHANGE_ME`:

| Setting                | What to put there                                                          |
| ---------------------- | -------------------------------------------------------------------------- |
| `ORBIT_DOMAIN`         | Your domain, only the name: `orbit.example.com`                            |
| `ORBIT_ADMIN_EMAIL`    | Your e-mail (Let's Encrypt writes here if the certificate has problems)    |
| `ORBIT_ALLOWED_EMAILS` | Google e-mails allowed to sign in, comma-separated: `me@gmail.com,b@x.com` |
| `GOOGLE_CLIENT_ID`     | From Google Cloud Console, see below                                       |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console, see below                                       |

`OPENROUTER_API_KEY` is optional but recommended: without it, reading photos of documents and
categorising transactions are switched off.

In `nano`, save with `Ctrl+O`, `Enter`, and leave with `Ctrl+X`.

### Google sign-in, step by step

1. Open <https://console.cloud.google.com/> and sign in with any Google account.
2. Click the project picker at the top → **New project** → name it `Orbit` → **Create**, and make
   sure it is selected.
3. Menu → **APIs & Services** → **OAuth consent screen**. Choose **External**, fill in the app
   name and your e-mail, save. When asked for **Test users**, add every e-mail from
   `ORBIT_ALLOWED_EMAILS`.
4. Menu → **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID**.
   - Application type: **Web application**.
   - **Authorized redirect URIs** → **Add URI** → `https://orbit.example.com/auth/v1/callback`
     (your domain instead of `orbit.example.com`, and exactly this path).
   - **Create**.
5. Copy the **Client ID** into `GOOGLE_CLIENT_ID` and the **Client secret** into
   `GOOGLE_CLIENT_SECRET`.

You can check the file without changing anything:

    deploy/orbit check

It prints one line per thing still missing, or `OK deploy/.env is complete`.

## Step 4 — Install

    deploy/orbit install

The first run takes 5–15 minutes: it downloads Supabase, builds the app and starts everything. It
prints what it is doing, and ends with:

    Orbit is up at https://orbit.example.com

Open that address, press **Sign in with Google**, and you are in.

`deploy/orbit install` also generated the passwords and keys the server needs and **appended them
to `deploy/.env`**. That file is now the key to all your data: **copy it to a password manager or
another safe place now.** Without it, even a perfect backup cannot be opened.

## Everyday commands

    deploy/orbit status            # is everything running? (all should say healthy)
    deploy/orbit logs web          # follow one service's log (Ctrl+C to stop)
    deploy/orbit restart           # restart everything
    deploy/orbit down              # stop everything; data stays in /var/lib/orbit

**Updating** to a newer Orbit:

    cd /opt/orbit
    git pull
    deploy/orbit update

`update` rebuilds the app, applies database changes and restarts only what changed. It is safe to
run as often as you like.

**Letting someone in, or out:** edit `ORBIT_ALLOWED_EMAILS` (and Google's test users) and run
`deploy/orbit migrate`. The list is the whole allowlist: an e-mail removed from it loses access.

**The Supabase dashboard** (tables, logs, SQL) is not on the internet. To open it:

    deploy/orbit studio

and follow the printed instructions (an SSH tunnel from your computer, then <http://localhost:8000>).
`deploy/orbit studio-stop` closes it again.

## When something goes wrong

| What you see                                        | What to do                                                                                                                                    |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `ERR deploy/.env: X is not filled in`               | Open `deploy/.env`, fill `X` following the comment above it, run the command again                                                            |
| `429 Too Many Requests` or timeouts pulling images  | Docker Hub limits or blocks your server. Set `ORBIT_REGISTRY_MIRROR=https://mirror.gcr.io` in `deploy/.env`, run `deploy/orbit install` again |
| The browser says the certificate is invalid         | DNS does not point at this server yet, or ports 80/443 are closed. Check `ping <domain>`, wait, then `deploy/orbit restart caddy`             |
| Google says `redirect_uri_mismatch`                 | The redirect URI in Google Cloud Console must be exactly `https://<ORBIT_DOMAIN>/auth/v1/callback`                                            |
| "Access denied" after signing in                    | Your e-mail is not in `ORBIT_ALLOWED_EMAILS`. Add it, run `deploy/orbit migrate`                                                              |
| A service is not `healthy` in `deploy/orbit status` | `deploy/orbit logs <service>` shows why. Most often a typo in `deploy/.env`                                                                   |
| The build stops with `Killed` or the server freezes | Not enough memory. Use a 4 GB server, or add swap: `fallocate -l 4G /swap && chmod 600 /swap && mkswap /swap && swapon /swap`                 |

## Secrets

Never edit the section of `deploy/.env` below `Generated by deploy/orbit`, and never delete a line
from it: the database was initialised with that password, and every signed-in session and connected
AI assistant was signed with that `JWT_SECRET`. `deploy/orbit` only ever adds what is missing.

To rotate a secret on purpose, stop the stack, change it in `deploy/.env` and in the place that
already holds it (the database password: `ALTER USER ... PASSWORD` for each Supabase role, as the
upstream `volumes/db/roles.sql` does; `JWT_SECRET`: also regenerate `ANON_KEY` and `SERVICE_ROLE_KEY`
by deleting them and running `deploy/orbit update`, which signs everyone out).

## For agents

You are deploying Orbit for a person. The contract:

- **The person owns three things you cannot produce:** a server they can SSH into, a domain whose A
  record points at it, and a Google OAuth client (Step 3). Ask for them up front, together, with
  the exact redirect URI `https://<domain>/auth/v1/callback`. Everything else you can do yourself.
- **Configuration is only `deploy/.env`.** Start from `deploy/.env.example`; it documents every
  variable. Do not edit `deploy/docker-compose.yml` or the downloaded `deploy/.upstream/` for a
  per-instance setting; put local overrides in your own compose file and list it in
  `ORBIT_COMPOSE_EXTRA`.
- **Commands are idempotent and say what failed.** `deploy/orbit check` validates without side
  effects and lists every problem, one per line, prefixed `ERR`. `deploy/orbit install` and
  `deploy/orbit update` may be re-run after any failure. Exit code 0 means done.
- **Success is observable:** `deploy/orbit install` ends with `Orbit is up at <url>`;
  `deploy/orbit status` lists every service `running` and `healthy`; `curl -sI https://<domain>/login`
  returns `HTTP/2 200`; `curl -s https://<domain>/auth/v1/health` returns JSON with `"name":"GoTrue"`.
- **Never** regenerate or remove lines below `Generated by deploy/orbit` in `deploy/.env`, never
  delete `/var/lib/orbit`, and never print the generated secrets into a chat.
- **Hand back** the URL, the fact that the person must store `deploy/.env` safely, and the output of
  `deploy/orbit status`.
