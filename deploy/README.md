# Deployment

Ukibori is a static site. On every push to `master`, the
[`Deploy`](../.github/workflows/deploy.yml) workflow rsyncs the site files to
`/opt/ukibori` on the server over SSH, and nginx serves that directory over
HTTPS at **https://ukibori.lasseharm.space**.

## GitHub repo secrets (already configured)

| Secret            | Purpose                                              |
| ----------------- | ---------------------------------------------------- |
| `SSH_PRIVATE_KEY` | Private key whose public half is in the deploy user's `~/.ssh/authorized_keys` |
| `SSH_HOST`        | Server hostname or IP                                |
| `SSH_USER`        | SSH/deploy user                                      |

## One-time server setup

Run these once on the server (`SSH_USER` needs sudo for the setup; the deploy
itself does not).

### 1. Create the project directory, owned by the deploy user

```bash
sudo mkdir -p /opt/ukibori
sudo chown "$USER":"$USER" /opt/ukibori
sudo chmod 755 /opt/ukibori   # nginx (www-data) must be able to read it
```

### 2. Install nginx + certbot

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 3. Install the nginx vhost

```bash
sudo cp /opt/ukibori/deploy/nginx/ukibori.conf /etc/nginx/sites-available/ukibori.conf
sudo ln -sf /etc/nginx/sites-available/ukibori.conf /etc/nginx/sites-enabled/ukibori.conf
```

> The committed `ukibori.conf` references TLS certs that don't exist yet, so it
> won't pass `nginx -t` until step 4. If you want nginx to start beforehand,
> obtain the cert with the standalone/webroot method first (step 4), then enable
> the vhost.

### 4. Obtain the SSL certificate (Let's Encrypt)

Point the DNS `A`/`AAAA` record for `ukibori.lasseharm.space` at the server
first, then:

```bash
sudo mkdir -p /var/www/certbot
sudo certbot --nginx -d ukibori.lasseharm.space
```

`certbot --nginx` provisions the cert and wires it into the vhost. Auto-renewal
is handled by the `certbot.timer` systemd unit installed with the package.

### 5. Reload nginx

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## Triggering a deploy

- Push to `master`, or
- Run the **Deploy** workflow manually from the Actions tab (`workflow_dispatch`).

The workflow uses `rsync --delete`, so `/opt/ukibori` is kept as an exact mirror
of the repo (minus `.git`, CI, and docs — see the `--exclude` list in the
workflow). Don't store anything else in `/opt/ukibori`; it will be removed.
