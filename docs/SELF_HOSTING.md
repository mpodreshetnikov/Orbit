# Self-Hosting Orbit

This guide puts Orbit on a server you rent, under a domain you own, with one command. It is written
for someone who has never run a server before; every step says what to type and what you should
see. If you are an AI agent doing this for someone, read [For agents](#for-agents) first.

What you end up with: Orbit at `https://<your domain>`, with a real HTTPS certificate, Google
sign-in limited to the e-mails you list, uploads, reminders and the AI features — the same app as
the hosted version, running entirely on your machine.

There are two ways to get there, and both end in the same server:

- **By hand**, Steps 1–5 below: you log in to the server and run three commands.
- **From GitHub**, [Deploy from GitHub](#deploy-from-github): you fork the repository, type your
  settings into its _Secrets and variables_ page and press one button; from then on every change on
  `main` deploys itself. You never log in to the server.

## What runs where

Everything lives on one server, in Docker containers that `deploy/orbit` starts and looks after:

- **Caddy** answers on ports 80 and 443, gets the HTTPS certificate from Let's Encrypt by itself,
  and sends each request to the right place.
- **web** is the Orbit app (Next.js). `deploy/orbit` downloads it ready-built for the exact commit
  you have checked out (CI publishes one for every commit on `main`, for x86 servers), and builds
  it on the server only when there is none: on an ARM server, or with changes of your own.
- **Supabase** is the backend: Postgres (the database), Auth (Google sign-in), Storage (uploaded
  files), Realtime, PostgREST and the Edge Functions. It is the official
  [self-hosted Supabase](https://supabase.com/docs/guides/self-hosting/docker) release, pinned in
  `deploy/supabase-upstream.env`; `deploy/orbit` downloads it and layers Orbit's settings
  (`deploy/docker-compose.yml`) on top.

The only file you edit is `deploy/.env`. Your data (database, files, certificates) is in
`/var/lib/orbit`.

## Step 1 — Get a server and a domain

**Server.** Any Linux virtual server ("VPS") with:

- 2 CPU cores, **2 GB RAM or more** (4 GB is comfortable), 40 GB disk — about $4–10 a month at
  most providers. Running, Orbit uses about 0.9 GB. An x86 (Intel/AMD) server is the simple
  choice: the app arrives ready-built. On an ARM server it is built on the server, which needs
  about 2 GB more for a few minutes on every update. For that case, and for safety, on a server
  with less than 4 GB `deploy/orbit install` adds a 2 GB swap file (set `ORBIT_NO_SWAP=true` in
  `deploy/.env` to skip it);
- Ubuntu 24.04 or Debian 12;
- a public IPv4 address, and ports 80 and 443 open.

**Domain.** Any domain or subdomain, e.g. `orbit.example.com`. In your domain registrar's DNS
settings create an **A record**: name `orbit` (or whatever you chose), value = your server's IP
address. It can take from a minute to an hour to start working; check with `ping orbit.example.com`
— it should show your server's IP.

## Step 2 — Prepare the server

Connect to the server (`ssh root@<server ip>`) and run this one line:

    curl -fsSL https://raw.githubusercontent.com/mpodreshetnikov/Orbit/main/deploy/bootstrap.sh | bash

In a minute or two it installs Docker, sets the server up safely ("What the server setup does",
below) and puts Orbit into `/opt/orbit`. It ends with `The server is ready.`

From now on log in as `orbit`, not `root`: `ssh orbit@<server ip>`, with the same key. Then:

    cd /opt/orbit

If you logged in with a password, not a key, the setup leaves passwords allowed and says so: add
your key first (`ssh-copy-id root@<server ip>` from your computer) and run the line again.

### What the server setup does

`deploy/bootstrap.sh` only does what a careful administrator would, and is safe to run again:

| What                       | Why                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| User `orbit` with `sudo`   | Day-to-day logins are not root; it gets the SSH keys root already has                      |
| SSH: keys only, no root    | Password guessing stops working. Done only once `orbit` has a key, so nobody is locked out |
| Firewall (`ufw`)           | Only SSH (22), HTTP (80) and HTTPS (443) are reachable from outside                        |
| `fail2ban`                 | An address that fails to log in 5 times in 10 minutes is banned for an hour                |
| Automatic security updates | Installed daily; if one needs a reboot, it happens at 04:30 UTC and Orbit starts by itself |
| Docker, logs capped        | Each service keeps at most 30 MB of logs, so they cannot fill the disk                     |

The database and the Supabase dashboard are not reachable from outside at all, firewall or not:
Orbit's containers publish only ports 80 and 443.

## Step 3 — Fill in the settings

    sudo nano deploy/.env

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

    sudo deploy/orbit check

It prints one line per thing still missing, or `OK deploy/.env is complete`.

## Step 4 — Install

    sudo deploy/orbit install

The first run takes 5–15 minutes: it downloads Supabase and the app and starts everything. If you
filled in the backup settings too (Step 5), it switches backups on as well. It prints what it is
doing, and ends with:

    Orbit is up at https://orbit.example.com

Open that address, press **Sign in with Google**, and you are in.

`deploy/orbit install` also created the passwords and keys the server needs, all derived from one
**master key**, and wrote them into `deploy/.env`. **Copy the master key to a password manager now**
(the install shows how to see it). With it and the backups, a lost server can be rebuilt with the
same keys; without it, even a perfect backup cannot be opened.

## Step 5 — Backups (do not skip this)

A server is one disk in one building. Disks die, data centres burn, accounts get blocked. Orbit
copies your data **off the server, to two places, continuously**, encrypted before it leaves:

| Copy                | What                                                                                               | How fresh                 | Where    |
| ------------------- | -------------------------------------------------------------------------------------------------- | ------------------------- | -------- |
| 1. Database journal | Every change to the database, plus a full copy every night (WAL-G)                                 | Within **1 minute**       | Bucket 1 |
| 2. Snapshots        | Uploaded files every 15 minutes; nightly a database dump, the Vault key and `deploy/.env` (restic) | 15 minutes (files), 1 day | Bucket 2 |

Two copies with two different tools at two different companies means one fire, one bankruptcy,
one blocked payment card or one bug cannot take everything. Every Sunday the server restores both
copies into a scratch area and reads them back — the database up to the last minute, the nightly
dump, the Vault key and the uploaded files — and checks none of them is out of date. If any backup
fails, goes stale, or the database stops handing its journal over, you get a message.

### Create the two buckets

A "bucket" is a folder in an online storage service that speaks the S3 protocol. Bucket 1 holds two
weeks of the database journal, about 80 MB a day (Orbit's reminders write to the database every
minute), so 1–2 GB plus the nightly copies; bucket 2 holds the snapshots, about the size of your data
and files. The cost is pennies or zero. Pick **two different companies**, ideally in
two different countries and not the one your server is with. Some that work:

- **Cloudflare R2** — 10 GB free. Endpoint `https://<account id>.r2.cloudflarestorage.com`, region
  `auto`.
- **Backblaze B2** — 10 GB free. Endpoint like `https://s3.eu-central-003.backblazeb2.com`, region
  `eu-central-003`.
- **Yandex Object Storage**, **Selectel**, **VK Cloud** — payable from Russia. Endpoint
  `https://storage.yandexcloud.net` (region `ru-central1`), `https://s3.ru-1.storage.selcloud.ru`
  (region `ru-1`), `https://hb.ru-msk.vkcloud-storage.ru` (region `ru-msk`).

At each one: create a bucket (private, no public access), then create an access key that can read
and write that bucket. You get an **access key ID** and a **secret access key**.

### Fill them in and switch backups on

In `deploy/.env`, section 4:

- bucket 1 → `BACKUP_WAL_S3_ENDPOINT`, `BACKUP_WAL_S3_PREFIX=s3://<bucket>/wal-g`,
  `BACKUP_WAL_S3_REGION`, and the key pair;
- bucket 2 → `BACKUP_SNAPSHOT_REPOSITORY=s3:<endpoint>/<bucket>/restic`, `BACKUP_SNAPSHOT_REGION`,
  and the key pair.

Then:

    sudo deploy/orbit update

It sees the new settings and switches backups on: checks both buckets, takes the first full backup
and prints the status (`deploy/orbit backup setup` does the same on its own). The keys that encrypt
the backups are derived from the master key, so the master key in your password manager is all you
need to open them. An instance installed before master keys existed has no master key: keep a copy
of its whole `deploy/.env` instead.

A bucket that already holds the backups of another Orbit — say, of a server you are replacing — is
refused rather than written over: restore from it first (below), or use a new folder.

### Get told when something is wrong

Two optional settings in the same section, both free:

- **Telegram**: message `@BotFather`, send `/newbot`, copy the token into `ALERT_TELEGRAM_BOT_TOKEN`.
  Send your new bot any message, open `https://api.telegram.org/bot<token>/getUpdates`, and copy the
  number after `"chat":{"id":` into `ALERT_TELEGRAM_CHAT_ID`.
- **healthchecks.io**: create a check with period 1 day and grace 2 hours, copy its ping URL into
  `BACKUP_HEALTHCHECK_URL`. The server pings it after each nightly backup; if the pings stop because
  the whole server is gone, healthchecks.io e-mails you. Telegram cannot do that part: a dead server
  sends no messages.

Run `deploy/orbit update` after changing them.

### Checking and restoring

    sudo deploy/orbit backup status     # when each copy last succeeded
    sudo deploy/orbit backup now        # take a full backup right now
    sudo deploy/orbit backup verify     # restore both copies into a scratch area and read them back

**Undo a mistake** (deleted something an hour ago) — restore the state from just before it:

    sudo deploy/orbit restore --time "2026-10-17 14:05:00+00"

**The server is gone** — on a new server, follow Steps 1–3 with the same settings, and put your
saved master key into `ORBIT_MASTER_KEY` before installing (or put your saved `deploy/.env` in place
instead, if the instance predates master keys). Then:

    sudo deploy/orbit install
    sudo deploy/orbit restore

`install` starts an empty Orbit and says the backup buckets hold another database's backups — the
old server's, which is what `restore` brings back.

`restore` asks you to type `RESTORE`, stops Orbit, rebuilds the database from bucket 1 (up to the
last minute, or to `--time`), brings back uploaded files and the Vault key from bucket 2, and starts
Orbit again. Nothing is deleted: the data it replaced stays in `/var/lib/orbit/*.before-restore-*`
until you remove it. If the restore fails, Orbit is put back on the data it had.

**Bucket 1 is lost too** — rebuild from the nightly snapshot in bucket 2 instead:

    sudo deploy/orbit restore --from-snapshot

This loads the nightly database dump (so up to a day of changes is lost) and the uploaded files from
the same moment. `--time` works here too and picks the last snapshot before it.

## Deploy from GitHub

The same setup as Steps 2–5, done by GitHub Actions in your fork of this repository: it logs in to
the server over SSH, prepares it with `deploy/bootstrap.sh`, writes `deploy/.env` from your settings
and installs — and after that deploys every commit that reaches `main`.

1.  **Fork** this repository on GitHub (the _Fork_ button), open the fork's _Actions_ tab once and
    enable workflows (GitHub keeps them off in a new fork), and do Step 1: a server and a domain.
2.  **Let GitHub log in to the server.** On your computer, make a key pair just for this:

        ssh-keygen -t ed25519 -f orbit-deploy -N ''

    and give the server the public half: `ssh-copy-id -i orbit-deploy.pub root@<server ip>` (or
    paste `orbit-deploy.pub` into your provider's "SSH keys" when creating the server).

3.  **Make the master key**: `openssl rand -hex 32`. Save the output in your password manager now —
    it is the one thing that, with the backups, rebuilds everything.
4.  **Type in the settings**: in your fork, _Settings → Secrets and variables → Actions_.

    | Where                                     | Name                                | Value                                                  |
    | ----------------------------------------- | ----------------------------------- | ------------------------------------------------------ |
    | Variables                                 | `ORBIT_SERVER_HOST`                 | The server's IP address                                |
    | Secrets                                   | `ORBIT_SSH_PRIVATE_KEY`             | The whole `orbit-deploy` file (the one without `.pub`) |
    | Secrets                                   | `ORBIT_MASTER_KEY`                  | The master key from step 3                             |
    | Variables, or Secrets for the secret ones | everything in `deploy/.env.example` | Same names, same values as Step 3 and Step 5 describe  |

    At the least `ORBIT_DOMAIN`, `ORBIT_ADMIN_EMAIL`, `ORBIT_ALLOWED_EMAILS` and `GOOGLE_CLIENT_ID`
    as variables and `GOOGLE_CLIENT_SECRET` as a secret; for backups, the `BACKUP_*` names. These
    go under _Secrets_, which nobody can read back: `GOOGLE_CLIENT_SECRET`, `OPENROUTER_API_KEY`,
    `WHO_ICD_CLIENT_SECRET`, the four `BACKUP_*_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY`,
    `ALERT_TELEGRAM_BOT_TOKEN`, `BACKUP_HEALTHCHECK_URL`, `OBS_GRAFANA_CLOUD_OTLP_HEADERS` (and, when
    moving from hosted Supabase, `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `VAPID_*`). Everything
    else is a _Variable_ — a setting saved as a secret under any other name is not read. Optional:
    `ORBIT_SERVER_USER` if your provider's login is not `root` (e.g. `ubuntu`), and
    `ORBIT_SSH_KNOWN_HOSTS` with the output of `ssh-keyscan <server ip>` so GitHub checks it talks to
    your server.

5.  **Deploy**: _Actions → Deploy to your server → Run workflow_. The first run takes 5–15 minutes and
    ends green; the log shows the same steps as a manual install.

After that, changing a setting is: edit it on the _Secrets and variables_ page, then _Run workflow_
again. That page is where the settings live from now on: one deleted there is emptied on the server
too, and an edit made in `deploy/.env` on the server by hand is overwritten by the next deploy. Every push to `main` (including syncing your fork) deploys by itself, after the checks pass.
Root login is switched off by the first run, which is why GitHub logs in as `orbit` from then on.

**The server is gone**: rent a new one with the same key (step 2), change `ORBIT_SERVER_HOST`,
and run the workflow with _action_ set to `restore`: it installs, then restores the latest backup.

## Moving from hosted Supabase

For an Orbit that already runs on Supabase's cloud (and Vercel). The old one keeps running the whole
time; you switch over only when the new one checks out, and you can switch back.

1.  **Collect from the hosted project**, in the Supabase dashboard of the old project:
    - _Project Settings → JWT Keys → Legacy JWT secret_: the value.
    - _Project Settings → API Keys → Legacy API keys_: `anon` and `service_role`.
    - _Connect → Session pooler_: the connection string, with the database password filled in.
    - Your edge function secrets, if you still have them: `OPENROUTER_API_KEY`, `WHO_ICD_CLIENT_*`,
      and `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (without the VAPID pair, every device has to turn
      notifications on again once).
2.  **Install the new server** as in Steps 1–5, but before `deploy/orbit install` add to the bottom of
    `deploy/.env`:

        JWT_SECRET=<legacy JWT secret>
        ANON_KEY=<legacy anon key>
        SERVICE_ROLE_KEY=<legacy service_role key>
        VAPID_PUBLIC_KEY=<…>
        VAPID_PRIVATE_KEY=<…>

    With the same JWT secret, people stay signed in and connected AI assistants keep working. Put
    everyone who has access today in `ORBIT_ALLOWED_EMAILS`. For the test, `ORBIT_DOMAIN` can be a
    new subdomain; the old address keeps serving the old Orbit.

3.  **Copy the data** (repeatable: each `import` replaces what the previous one loaded):

    export SOURCE_DB_URL='postgresql://postgres.<ref>:<password>@<pooler host>:5432/postgres'
    export SOURCE_SUPABASE_URL='https://<ref>.supabase.co'
    export SOURCE_SERVICE_ROLE_KEY='<legacy service_role key>'

    # reads only; the old project is not changed. sudo passes on these three only when told to:

    sudo --preserve-env=SOURCE_DB_URL,SOURCE_SUPABASE_URL,SOURCE_SERVICE_ROLE_KEY \
     deploy/orbit migrate-from-supabase export
    sudo deploy/orbit migrate-from-supabase import # asks you to type IMPORT

    # ends with: verified: N tables have the same row counts, M objects the same bytes

4.  **Check the new one** at its address: sign in, open records and their files, wait for a reminder.
    Until you switch, both send reminders, so a device may get each one twice.
5.  **Switch**, at a quiet moment:
    1.  Stop writing to the old one. Nobody uses the old Orbit — the website, the browser extension or
        an AI assistant — from here on: what it writes after the last export would not be copied. Then
        pause the old one's scheduled jobs, in the old project's _SQL Editor_:

            update cron.job set active = false;

    2.  Run `export` and `import` once more, so the copy is complete.
    3.  Point the domain at the new server (or keep the new subdomain), and add
        `https://<domain>/auth/v1/callback` to the Google OAuth client's redirect URIs.

6.  **Switch back**, if something is wrong: point the domain back and resume its jobs
    (`update cron.job set active = true;`). Apart from that pause, the old project was never touched.
    Turn it off (Supabase project, Vercel project) only after a week or two of the new one working.

## Everyday commands

Log in as `orbit` and `cd /opt/orbit` first. `deploy/orbit` runs as root, hence the `sudo`.

    sudo deploy/orbit status            # is everything running? (all should say healthy)
    sudo deploy/orbit logs web          # follow one service's log (Ctrl+C to stop)
    sudo deploy/orbit restart           # restart everything
    sudo deploy/orbit down              # stop everything; data stays in /var/lib/orbit

**Updating** to a newer Orbit:

    cd /opt/orbit
    git pull
    sudo deploy/orbit update

`update` gets the new app, applies database changes and restarts only what changed. It is safe to
run as often as you like.

**Letting someone in, or out:** edit `ORBIT_ALLOWED_EMAILS` (and Google's test users) and run
`deploy/orbit migrate`. The list is the whole allowlist: an e-mail removed from it loses access.

**The Supabase dashboard** (tables, logs, SQL) is not on the internet. To open it:

    sudo deploy/orbit studio

and follow the printed instructions (an SSH tunnel from your computer, then <http://localhost:8000>).
`deploy/orbit studio-stop` closes it again.

## When something goes wrong

| What you see                                          | What to do                                                                                                                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ERR deploy/.env: X is not filled in`                 | Open `deploy/.env`, fill `X` following the comment above it, run the command again                                                                                       |
| `429 Too Many Requests` or timeouts pulling images    | Docker Hub limits or blocks your server. Set `ORBIT_REGISTRY_MIRROR=https://mirror.gcr.io` in `deploy/.env`, run `deploy/orbit install` again                            |
| The browser says the certificate is invalid           | DNS does not point at this server yet, or ports 80/443 are closed. Check `ping <domain>`, wait, then `deploy/orbit restart caddy`                                        |
| Google says `redirect_uri_mismatch`                   | The redirect URI in Google Cloud Console must be exactly `https://<ORBIT_DOMAIN>/auth/v1/callback`                                                                       |
| "Access denied" after signing in                      | Your e-mail is not in `ORBIT_ALLOWED_EMAILS`. Add it, run `deploy/orbit migrate`                                                                                         |
| A service is not `healthy` in `deploy/orbit status`   | `deploy/orbit logs <service>` shows why. Most often a typo in `deploy/.env`                                                                                              |
| `No prebuilt images for this commit` on an x86 server | CI publishes them about 15 minutes after a commit reaches `main`; it builds here meanwhile, which is fine. To download instead, wait and run `deploy/orbit update` again |
| The build stops with `Killed` or the server freezes   | Not enough memory for the build. `swapon --show` should list `/orbit.swap`; if your provider forbids swap, use a 4 GB server                                             |

## Secrets

Every password and key the server needs for itself is derived from `ORBIT_MASTER_KEY` and written
into the section of `deploy/.env` below `Generated by deploy/orbit`. A value you set yourself always
wins over the derived one — moving from hosted Supabase uses this to keep its `JWT_SECRET`.

Never edit that section, never delete a line from it, and never change `ORBIT_MASTER_KEY` once
installed: the database was initialised with that password, and every signed-in session and
connected AI assistant was signed with that `JWT_SECRET`. `deploy/orbit` only ever adds what is
missing.

To rotate a secret on purpose, stop the stack, change it in `deploy/.env` and in the place that
already holds it (the database password: `ALTER USER ... PASSWORD` for each Supabase role, as the
upstream `volumes/db/roles.sql` does; `JWT_SECRET`: also regenerate `ANON_KEY` and `SERVICE_ROLE_KEY`
by deleting them and running `deploy/orbit update`, which signs everyone out).

## For agents

You are deploying Orbit for a person. The contract:

- **The person owns three things you cannot produce:** a server they can SSH into, a domain whose A
  record points at it, and a Google OAuth client (Step 3). Ask for them up front, together, with
  the exact redirect URI `https://<domain>/auth/v1/callback`. Everything else you can do yourself.
- **Prepare a fresh server with `deploy/bootstrap.sh`** (Step 2), as root. With
  `ORBIT_SETTINGS=<file of NAME=value lines>` it also fills `deploy/.env` and installs, unattended.
  It locks SSH to keys and disables root login: reconnect as `orbit` afterwards.
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
  change `ORBIT_MASTER_KEY`, never delete `/var/lib/orbit`, and never print the master key or the
  generated secrets into a chat. Tell the person to save the master key, and how to see it.
- **Backups are part of done.** Ask for two S3 buckets at two different providers (Step 5) and run
  `deploy/orbit backup setup`; `deploy/orbit backup verify` must print `restore verified`.
- **Moving an existing Orbit** off hosted Supabase is "Moving from hosted Supabase" above.
  `export` only reads the old project; never shut the old project down yourself — that is the
  person's call, after they have used the new one.
- **Hand back** the URL, the fact that the person must store `deploy/.env` safely, and the output of
  `deploy/orbit status`.
