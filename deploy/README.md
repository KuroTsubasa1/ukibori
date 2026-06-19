# Deployment

Ukibori is a static site. On every push to `master`, the
[`Deploy`](../.github/workflows/deploy.yml) workflow:

1. rsyncs the site files to `/opt/ukibori` over SSH, then
2. runs [`provision.sh`](provision.sh) on the server, which installs the nginx
   vhost and — on the very first deploy — obtains the Let's Encrypt certificate
   automatically (http-01 challenge), then reloads nginx.

The site is served over HTTPS at **https://ukibori.lasseharm.space**.

## GitHub repo configuration

Secrets (already configured):

| Secret            | Purpose                                              |
| ----------------- | ---------------------------------------------------- |
| `SSH_PRIVATE_KEY` | Private key whose public half is in the deploy user's `~/.ssh/authorized_keys` |
| `SSH_HOST`        | Server hostname or IP                                |
| `SSH_USER`        | SSH/deploy user                                      |

Variables (optional):

| Variable        | Purpose                                                            |
| --------------- | ----------------------------------------------------------------- |
| `CERTBOT_EMAIL` | Email for Let's Encrypt expiry notices. Defaults to `lasse.harm@di-unternehmer.com` if unset. |

## One-time server setup

The pipeline installs the nginx vhost and obtains the certificate itself. You
only need to satisfy these prerequisites once:

### 1. DNS

Point the `A`/`AAAA` record for `ukibori.lasseharm.space` at the server. This
must resolve **before** the first deploy, or the http-01 challenge will fail.

### 2. Install nginx + certbot

```bash
sudo apt update
sudo apt install -y nginx certbot
```

### 3. Create the project directory, owned by the deploy user

```bash
sudo mkdir -p /opt/ukibori
sudo chown "$USER":"$USER" /opt/ukibori
sudo chmod 755 /opt/ukibori   # nginx (www-data) must be able to read it
```

### 4. Grant the deploy user passwordless sudo

`provision.sh` runs `certbot`, `nginx`, `systemctl`, etc. via `sudo` over a
non-interactive SSH session, so the deploy user needs `NOPASSWD` sudo. Create
`/etc/sudoers.d/ukibori-deploy` (replace `DEPLOY_USER`):

```
DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/certbot, /usr/sbin/nginx, /bin/systemctl reload nginx, /bin/mkdir, /bin/cp, /bin/ln, /bin/rm, /usr/bin/tee
```

> Tighten or broaden to taste. The simplest (least restrictive) alternative is a
> blanket `DEPLOY_USER ALL=(root) NOPASSWD: ALL`.

That's it — push to `master` and the first deploy provisions everything.
Certificate **renewal** thereafter is handled automatically by the `certbot.timer`
systemd unit; the port-80 block in the vhost keeps the webroot challenge path
available for renewals.

## Triggering a deploy

- Push to `master`, or
- Run the **Deploy** workflow manually from the Actions tab (`workflow_dispatch`).

The workflow uses `rsync --delete`, so `/opt/ukibori` is kept as an exact mirror
of the repo (minus `.git`, CI, and docs — see the `--exclude` list in the
workflow). Don't store anything else in `/opt/ukibori`; it will be removed.
