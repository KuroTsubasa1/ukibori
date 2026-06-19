#!/usr/bin/env bash
# Idempotent server provisioning for ukibori.lasseharm.space.
#
# Run on every deploy. On first run (no cert yet) it bootstraps a temporary
# HTTP-only vhost so Let's Encrypt can answer the http-01 challenge, obtains the
# certificate, then installs the real (SSL) vhost. On later runs it just keeps
# the nginx config in sync and reloads. Cert *renewal* is handled by the
# certbot systemd timer; webroot challenges keep working via the port-80 block.
#
# Requires: nginx, certbot installed; the invoking user has (passwordless) sudo.
set -euo pipefail

DOMAIN="ukibori.lasseharm.space"
EMAIL="${CERTBOT_EMAIL:-lasse.harm@di-unternehmer.com}"
WEBROOT="/var/www/certbot"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

NGINX_AVAIL="/etc/nginx/sites-available/ukibori.conf"
NGINX_ENABLED="/etc/nginx/sites-enabled/ukibori.conf"
BOOTSTRAP_AVAIL="/etc/nginx/sites-available/ukibori-bootstrap.conf"
BOOTSTRAP_ENABLED="/etc/nginx/sites-enabled/ukibori-bootstrap.conf"

sudo mkdir -p "$WEBROOT" /opt/ukibori

# --- Bootstrap: obtain the cert if it doesn't exist yet -----------------------
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    echo "No certificate for $DOMAIN yet — bootstrapping via http-01 challenge."

    # Temporary HTTP-only vhost that only serves the ACME challenge.
    sudo tee "$BOOTSTRAP_AVAIL" >/dev/null <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ { root $WEBROOT; }
    location / { return 200 'bootstrapping'; }
}
EOF

    # Enable only the bootstrap vhost (the real one references a cert that does
    # not exist yet, so it must not be loaded during bootstrap).
    sudo rm -f "$NGINX_ENABLED"
    sudo ln -sf "$BOOTSTRAP_AVAIL" "$BOOTSTRAP_ENABLED"
    # NB: keep `nginx -t` and the reload on separate lines. In a `cmd && cmd`
    # list, a failure of the first command is exempt from `set -e`, so a bad
    # config would be silently swallowed and the deploy would go green anyway.
    sudo nginx -t
    sudo systemctl reload nginx

    sudo certbot certonly --webroot -w "$WEBROOT" -d "$DOMAIN" \
        --non-interactive --agree-tos -m "$EMAIL"
fi

# --- Install the real (SSL) vhost ---------------------------------------------
sudo rm -f "$BOOTSTRAP_ENABLED"
sudo cp "$SCRIPT_DIR/nginx/ukibori.conf" "$NGINX_AVAIL"
sudo ln -sf "$NGINX_AVAIL" "$NGINX_ENABLED"
sudo nginx -t
sudo systemctl reload nginx

echo "Provisioning complete: https://$DOMAIN"
