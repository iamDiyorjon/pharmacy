# Pharmacy Pickup — instructions for Claude

## ⚠️ Bu loyiha faqat **prod** muhitida ishlaydi — lokal stack ishga tushirilmasin

Lokal va prod **bir xil Telegram bot tokenini** ishlatadi (`.env` da `TELEGRAM_BOT_TOKEN`). Lokal `.env` da `DEBUG=true` bo'lgani uchun, `docker compose up` ishga tushirilsa `app/main.py` da `bot.delete_webhook(...)` + `dp.start_polling(...)` chaqiriladi va prod webhook'iga **to'g'ridan-to'g'ri ta'sir qiladi** (Telegram update'larini o'g'irlab ketadi yoki tushirib yuboradi).

**Qoidalar:**

1. **`docker compose up` (yoki backend'ni uvicorn bilan) lokalda ishga tushirmang** — frontend-only ishlar bundan mustasno, lekin u holda ham aiogram bilan bog'liq kod o'zgarishlari prod'da test qilinadi.
2. **Telegram bot'i bilan bog'liq diagnostika faqat read-only API orqali**:
   - `getWebhookInfo`, `getMe`, `getUpdates` — bemalol
   - `setWebhook`, `deleteWebhook`, `start_polling` — **YO'Q**, prod buziladi
3. **Backend / bot / DB tekshirish** kerak bo'lsa, to'g'ridan-to'g'ri prod serverga ulaning:
   ```bash
   ssh -i ~/.ssh/pharmacy_deploy root@159.203.168.109
   cd /var/www/pharmacy
   docker compose ps
   docker logs pharmacy-backend-1 --tail=50
   ```
4. **Kod o'zgarishlari** — push to `main` qilinadi, GitHub Actions self-hosted runner avtomatik deploy qiladi (`CI_CD_GUIDE.md`). Backend volume-mount + `--reload` ishlatadi, shuning uchun code o'zgarishi avtomatik. `requirements.txt` o'zgarsa rebuild kerak.
5. **Webhook holati**: prod `.env` da `TELEGRAM_WEBHOOK_URL=https://pharmacy.kulliyot.uz/api/telegram/webhook` va random `TELEGRAM_WEBHOOK_SECRET` bor. Backend lifespan `setWebhook` ni o'zi chaqiradi. Webhook'ni qo'lda o'zgartirmang.
6. **Lokal `.env` ni dev token bilan o'zgartirish** istalsa, avval foydalanuvchidan so'rang — uni hozircha bilib qo'yib o'zgartirmang.

## Server & topology

- VPS: `root@159.203.168.109` (hostname `ubuntu-s-1vcpu-1gb-nyc3-01`)
- Project path: `/var/www/pharmacy`
- Domain: `https://pharmacy.kulliyot.uz`
- Nginx (host): `/` → frontend (`:5173`), `/api/` → backend (`:8001`)
- Containers: `pharmacy-backend-1`, `pharmacy-frontend-1`, `pharmacy-postgres-1`, `pharmacy-minio-1`
- SSH kalit: `~/.ssh/pharmacy_deploy` (default `id_ed25519` authorized emas)

## Foydali hujjatlar (loyiha ichida)

- `DEPLOY.md` — server ma'lumotlari, manual deploy
- `CI_CD_GUIDE.md` — self-hosted runner orqali avtomatik deploy
- `.env.production.example` — prod env shabloni
