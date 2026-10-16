# Backend — product image resize (cashier performance)

## What
- On **admin upload** of images: Sharp → **WebP 480** (primary `url` / `image_url`) + **WebP 960** (`urlFull`).
- Videos unchanged.
- Catalog still rewrites `/uploads/…` → `/api/devices/images/…` absolute HTTPS.
- Script to migrate old heavy files: `npm run images:reprocess`

## Deploy
```bash
cd backend
npm install          # pulls sharp
# restart backend service
npm run images:reprocess   # optional, once, for existing products
```

Env: `PUBLIC_BASE_URL=https://app.67coffee.ru`

## Effect on till
Cashier downloads ~40–100 KB WebP instead of 1–2 MB JPEG → less lag on scroll.
