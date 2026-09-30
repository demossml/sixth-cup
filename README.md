# Шестой стакан — backend + PWA

Веб-проект лояльности и бизнес-админки. **Android/Эвотор — отдельный репозиторий.**

## Быстрый старт (dev)

```bash
npm install
npm run dev
# http://localhost:5173  ·  API :3000
```

Админка: `/admin`, токен `dev-admin`.

## Production

См. **[DEPLOYMENT.md](./DEPLOYMENT.md)** (Mac mini, HTTPS, env).

Контракт для будущей Android-кассы: **[ANDROID_INTEGRATION_CONTRACT.md](./ANDROID_INTEGRATION_CONTRACT.md)**.

## Возможности

| | |
|--|--|
| Юрлица + НДС / режим | `/admin` → Юрлица |
| Точки | `/admin` → Точки |
| Категории и товары + фото | `/admin` → создание и **редактирование**, скрыть из меню |
| Клиентское меню | `/menu` |
| PWA-касса лояльности | `/cashier` |
| Directory / enroll / sync | API для внешней кассы |

Цена везде в **рублях** (integer).
