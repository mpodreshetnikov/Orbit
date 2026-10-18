# Install Orbit

Your own Orbit on a server you rent, set up and updated by GitHub: you never log in to the server.
About an hour the first time, most of it waiting. Each step links to the part of
[`docs/SELF_HOSTING.md`](./docs/SELF_HOSTING.md) that explains it in full; read that one when a
step is not clear. An AI agent doing this for someone starts at its
[For agents](./docs/SELF_HOSTING.md#for-agents) section.

You need: a GitHub account, a Google account, and about 5 € a month for the server.

## Checklist

1. **Fork** this repository, then open the fork's _Actions_ tab and enable workflows.
2. **Rent a server**: Ubuntu 24.04, 2 CPU, 2 GB RAM or more (4 GB is comfortable), 40 GB disk,
   x86. Note its IP address.
3. **Pick an address.** Your own domain with an `A` record pointing at the server, or, until you
   have one, `<ip with dashes>.sslip.io` (for `1.2.3.4`: `1-2-3-4.sslip.io`), which needs no setup
   at all. [Step 1](./docs/SELF_HOSTING.md#step-1--get-a-server-and-a-domain)
4. **Make a key for GitHub to log in with**, on your computer:
   `ssh-keygen -t ed25519 -f orbit-deploy -N ""`, then put `orbit-deploy.pub` on the server as
   root's key (`ssh-copy-id -i orbit-deploy.pub root@<ip>`, or your provider's "SSH keys" page).
   [Deploy from GitHub, step 2](./docs/SELF_HOSTING.md#deploy-from-github)
5. **Make the master key**: `openssl rand -hex 32`. Save it in your password manager: with the
   backups, it is all it takes to rebuild everything.
6. **Make a Google sign-in client** with the redirect URI `https://<your address>/auth/v1/callback`.
   [Google sign-in, step by step](./docs/SELF_HOSTING.md#google-sign-in-step-by-step)
7. **Make backup storage**: S3-compatible buckets at companies other than your server's. Two
   companies are safest; one bucket, holding both copies in two folders, is enough to start.
   [Create the two buckets](./docs/SELF_HOSTING.md#create-the-two-buckets)
8. **Type the settings into GitHub**: the fork's _Settings → Environments → production_ (create it).

   | Kind      | Name                                                                                                 |
   | --------- | ---------------------------------------------------------------------------------------------------- |
   | Variables | `ORBIT_SERVER_HOST`, `ORBIT_DOMAIN`, `ORBIT_ADMIN_EMAIL`, `ORBIT_ALLOWED_EMAILS`, `GOOGLE_CLIENT_ID` |
   | Secrets   | `ORBIT_SSH_PRIVATE_KEY` (the whole `orbit-deploy` file), `ORBIT_MASTER_KEY`, `GOOGLE_CLIENT_SECRET`  |
   | Backups   | `BACKUP_*`: variables for the addresses, secrets for the keys                                        |

   Which name is a secret and which a variable, and the optional ones (AI, alerts):
   [Deploy from GitHub, step 4](./docs/SELF_HOSTING.md#deploy-from-github).

9. **Deploy**: _Actions → Deploy to your server → Run workflow_. The first run takes 5–15 minutes
   and ends with `Orbit is up at https://<your address>`.
10. **Open it** and sign in with Google.

From then on every change on `main` (syncing your fork included) deploys by itself, and a changed
setting takes effect at the next _Run workflow_.

## Already on Orbit's hosted version?

Run the workflow with _action_ `migrate-from-supabase`: it copies the users, records and files,
then checks every table and file against the original, which keeps running untouched.
[Moving from hosted Supabase](./docs/SELF_HOSTING.md#moving-from-hosted-supabase)

## When it does not work

- Run the workflow with _action_ `doctor`: it shows what the server's network can and cannot reach,
  changing nothing.
- [When something goes wrong](./docs/SELF_HOSTING.md#when-something-goes-wrong) lists the usual
  messages and what to do about each.
