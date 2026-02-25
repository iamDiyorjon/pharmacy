#!/bin/bash
set -e

# ===========================================
# Pharmacy VPS Setup Script
# Run this ONCE on a fresh VPS
# Usage: bash setup-server.sh
# ===========================================

DOMAIN="pharmacy.proeduedge.uz"
APP_DIR="/var/www/pharmacy"
REPO_URL="https://github.com/iamDiyorjon/pharmacy.git"

echo "=== 1. Installing Docker ==="
if ! command -v docker &> /dev/null; then
    apt-get update
    apt-get install -y ca-certificates curl gnupg
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    echo "Docker installed successfully"
else
    echo "Docker already installed"
fi

echo "=== 2. Cloning Repository ==="
if [ ! -d "$APP_DIR" ]; then
    git clone "$REPO_URL" "$APP_DIR"
    echo "Repository cloned to $APP_DIR"
else
    echo "Directory $APP_DIR already exists, pulling latest..."
    cd "$APP_DIR" && git pull
fi

echo "=== 3. Setting up .env ==="
cd "$APP_DIR"
if [ ! -f .env ]; then
    cp .env.production.example .env
    echo ""
    echo "!!! IMPORTANT: Edit /var/www/pharmacy/.env with your actual values !!!"
    echo "    nano /var/www/pharmacy/.env"
    echo ""
else
    echo ".env already exists"
fi

echo "=== 4. Configuring Nginx ==="
cp "$APP_DIR/deploy/pharmacy.nginx.conf" /etc/nginx/sites-available/pharmacy
ln -sf /etc/nginx/sites-available/pharmacy /etc/nginx/sites-enabled/pharmacy
nginx -t && systemctl reload nginx
echo "Nginx configured for $DOMAIN"

echo "=== 5. SSL Certificate ==="
if ! certbot certificates 2>/dev/null | grep -q "$DOMAIN"; then
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email admin@proeduedge.uz
    echo "SSL certificate obtained"
else
    echo "SSL certificate already exists"
fi

echo "=== 6. Building & Starting Containers ==="
cd "$APP_DIR"
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d

echo "=== 7. Running Database Migrations ==="
sleep 5
docker compose -f docker-compose.prod.yml exec backend alembic upgrade head

echo ""
echo "========================================="
echo "  Setup complete!"
echo "  Site: https://$DOMAIN"
echo "  API:  https://$DOMAIN/api/docs"
echo "========================================="
