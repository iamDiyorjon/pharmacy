# Pharmacy Pickup — Deployment Guide

## Server Info

| Item | Value |
|------|-------|
| IP | `159.203.168.109` |
| User | `root` |
| Project path | `/var/www/pharmacy` |
| Domain | `https://pharmacy.proeduedge.uz` |
| SSL | Let's Encrypt (auto-managed by Certbot) |

## Architecture

```
Internet
  │
  ▼
Nginx (host, port 80/443)
  ├── /      → frontend container (localhost:5173)
  └── /api/  → backend container  (localhost:8001)

Docker containers:
  ┌──────────────────────────────────────────┐
  │  frontend   (nginx:alpine, port 5173:80) │
  │  backend    (python:3.11, port 8001:8000)│
  │  postgres   (postgres:15-alpine)         │
  │  minio      (minio:latest)               │
  └──────────────────────────────────────────┘
```

## Prerequisites

- SSH access to the server (via terminal or WinSCP)
- Docker and Docker Compose installed on the server (already set up)

## Connecting to the Server

**Terminal:**
```bash
ssh root@159.203.168.109
```

**WinSCP (file upload):**
- Protocol: SCP
- Host: `159.203.168.109`, Port: `22`
- User: `root`

---

## Deploying Changes

### Frontend Changes

The frontend is a React (Vite) app built into a static Nginx image. Any change requires a **rebuild**.

```bash
# 1. SSH into the server
ssh root@159.203.168.109

# 2. Go to the project
cd /var/www/pharmacy

# 3. Edit files or upload via WinSCP to /var/www/pharmacy/frontend/src/...

# 4. Rebuild and restart the frontend container
docker compose build frontend
docker compose up -d frontend

# 5. Verify it's running
docker ps | grep frontend
```

### Backend Changes

The backend uses a **volume mount** (`./backend:/app`) with `--reload`, so file changes are picked up **automatically** — no rebuild needed for code changes.

```bash
# 1. SSH into the server
ssh root@159.203.168.109

# 2. Edit files directly or upload via WinSCP to /var/www/pharmacy/backend/app/...
# Uvicorn auto-reloads on file change.

# 3. If you need to restart manually:
cd /var/www/pharmacy
docker compose restart backend

# 4. Check logs for errors:
docker logs pharmacy-backend-1 --tail=50
```

> **Note:** If you change `requirements.txt` (add/remove Python packages), you must rebuild:
> ```bash
> docker compose build backend
> docker compose up -d backend
> ```

### Database Migrations

```bash
cd /var/www/pharmacy

# Run Alembic migrations inside the backend container
docker compose exec backend alembic upgrade head

# Check current migration version
docker compose exec backend alembic current
```

---

## Useful Commands

### View logs
```bash
# Backend logs (live)
docker logs -f pharmacy-backend-1

# Frontend logs
docker logs -f pharmacy-frontend-1

# All services
docker compose logs -f
```

### Restart all services
```bash
cd /var/www/pharmacy
docker compose restart
```

### Rebuild everything from scratch
```bash
cd /var/www/pharmacy
docker compose down
docker compose build --no-cache
docker compose up -d
```

### Check container status
```bash
docker ps
```

### Access database
```bash
docker compose exec postgres psql -U pharmacy -d pharmacy_db
```

### Access MinIO console
MinIO is not exposed externally. To access the console, use SSH port forwarding:
```bash
ssh -L 9001:localhost:9001 root@159.203.168.109
```
Then open `http://localhost:9001` in your browser.

---

## Environment Variables

The `.env` file at `/var/www/pharmacy/.env` contains:

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `TELEGRAM_WEBAPP_URL` | Mini App URL |
| `DATABASE_URL` | PostgreSQL connection string |
| `POSTGRES_PASSWORD` | DB password |
| `MINIO_ENDPOINT` | MinIO host |
| `MINIO_ACCESS_KEY` | MinIO access key |
| `MINIO_SECRET_KEY` | MinIO secret key |
| `MINIO_BUCKET` | S3 bucket name |
| `SECRET_KEY` | JWT signing secret |
| `DEBUG` | Enable debug mode |
| `CLICK_*` | Click payment credentials |
| `PAYME_*` | Payme payment credentials |
| `ADMIN_TELEGRAM_ID` | Admin Telegram user ID |

---

## Host Nginx Config

Located at `/etc/nginx/sites-available/pharmacy`. Managed by Certbot for SSL.

If you need to edit it:
```bash
nano /etc/nginx/sites-available/pharmacy
nginx -t          # test config
systemctl reload nginx
```
