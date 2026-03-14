# CI/CD Guide — Self-Hosted Runner Deployment

## What is CI/CD?

CI/CD (Continuous Integration / Continuous Deployment) automatically deploys your code to the server every time you push changes. No manual SSH, no manual commands — just push and it's live.

---

## How Our CI/CD Works

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   Developer pushes code to "main" branch on GitHub              │
│                                                                 │
│         git push origin main                                    │
│                                                                 │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   GitHub detects the push and triggers the workflow             │
│                                                                 │
│   File: .github/workflows/deploy.yml                            │
│                                                                 │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   Self-hosted runner on our VPS receives the job                │
│                                                                 │
│   Location: /opt/actions-runner                                 │
│   The runner is a small service that listens for GitHub jobs    │
│                                                                 │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   Runner executes these commands automatically:                 │
│                                                                 │
│   1. cd /var/www/<project>                                      │
│   2. git pull origin main          ← download latest code       │
│   3. docker compose build          ← rebuild containers         │
│   4. docker compose up -d          ← restart with new code      │
│   5. alembic upgrade head          ← run DB migrations          │
│                                                                 │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   ✅ Site is updated!                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## What is a Self-Hosted Runner?

Normally, GitHub runs your CI/CD jobs on **their servers** (called "GitHub-hosted runners"). This costs money for private repositories.

A **self-hosted runner** is a small program installed on **your own server** that does the same thing — for free.

```
┌─────────────────────┐         ┌─────────────────────┐
│       GitHub         │         │     Your VPS        │
│                      │  job    │                     │
│  "Hey, someone       │ ──────► │                     │
│   pushed to main,    │         │  Runner receives    │
│   run the deploy"    │         │  the job and runs   │
│                      │ ◄────── │  deploy commands    │
│  "Got it, status:    │ result  │  locally            │
│   success ✅"        │         │                     │
└─────────────────────┘         └─────────────────────┘
```

**Benefits:**
- Free (no GitHub billing needed)
- Faster (no SSH overhead, runs directly on the server)
- No secrets needed (runner is already on the server)

---

## The Workflow File

Located at `.github/workflows/deploy.yml`:

```yaml
name: Deploy to VPS

on:
  push:
    branches: [main]     # ← triggers only on push to main

jobs:
  deploy:
    runs-on: self-hosted  # ← uses our VPS runner, not GitHub's
    steps:
      - name: Deploy
        run: |
          cd /var/www/<project>
          git pull origin main
          docker compose -f docker-compose.prod.yml build
          docker compose -f docker-compose.prod.yml up -d
          docker compose -f docker-compose.prod.yml exec -T backend alembic upgrade head
```

---

## Step-by-Step: How to Deploy

### The Easy Way (automatic)

1. Make your code changes
2. Commit and push to `main`:
   ```bash
   git add .
   git commit -m "Your change description"
   git push origin main
   ```
3. Go to your repository's **Actions** tab on GitHub to see the progress
4. Green checkmark ✅ = deployed successfully

### Check Deploy Status

Go to: **GitHub → Your Repository → Actions tab**

| Icon | Meaning |
|------|---------|
| ✅ Green checkmark | Deploy succeeded |
| ❌ Red X | Deploy failed — click to see the error |
| 🟡 Yellow circle | Deploy is running |

### If Deploy Fails

1. Click the failed run on the Actions page
2. Click the "deploy" job
3. Read the error message
4. Fix the issue, push again — a new deploy triggers automatically

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                    Internet                               │
└─────────────────────┬────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────────────┐
│              Nginx (host server)                          │
│                                                          │
│  yourdomain.com                                          │
│  ├── /      → Frontend (port 5173)                       │
│  └── /api/  → Backend  (port 8001)                       │
│                                                          │
│  SSL: Let's Encrypt (auto-renewed)                       │
└─────────────────────┬────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────────────┐
│              Docker Containers                            │
│                                                          │
│  ┌────────────┐  ┌────────────┐  ┌──────┐  ┌─────────┐ │
│  │  Frontend   │  │  Backend   │  │ DB   │  │  MinIO  │ │
│  │  React+Nginx│  │  FastAPI   │  │Postgres│ │ Storage │ │
│  │  :5173      │  │  :8001     │  │:5432  │  │ :9000   │ │
│  └────────────┘  └────────────┘  └──────┘  └─────────┘ │
│                                                          │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  GitHub Actions Runner (background service)               │
│  Location: /opt/actions-runner                            │
│  Listens for deploy jobs from GitHub                      │
└──────────────────────────────────────────────────────────┘
```

---

## Important Paths on Server

| Path | Description |
|------|-------------|
| `/var/www/<project>` | Project root |
| `/var/www/<project>/.env` | Environment variables |
| `/var/www/<project>/backend/` | Backend source code |
| `/var/www/<project>/frontend/` | Frontend source code |
| `/opt/actions-runner/` | GitHub Actions runner |
| `/etc/nginx/sites-available/<project>` | Nginx reverse proxy config |

---

## Useful Commands (on the server)

```bash
# Check if runner is active
systemctl status actions.runner.<org>-<repo>.<runner-name>

# Restart the runner
systemctl restart actions.runner.<org>-<repo>.<runner-name>

# View backend logs
docker logs -f <project>-backend-1

# View all containers
docker ps

# Manual deploy (if CI/CD is down)
cd /var/www/<project>
git pull origin main
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

---

## Summary

| Question | Answer |
|----------|--------|
| How to deploy? | Push to `main` branch |
| Where to check status? | GitHub → Actions tab |
| How long does it take? | ~30-60 seconds |
| Does it cost money? | No (self-hosted runner) |
| What if it fails? | Check Actions tab for error, fix, push again |
| Can I deploy manually? | Yes, SSH into server and run docker compose commands |
