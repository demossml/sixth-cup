# Шестой стакан — backend + PWA

Веб-проект лояльности и бизнес-админки. **Android/Эвотор — отдельный репозиторий.**

## Установка на Mac mini

Полная пошаговая инструкция → [DEPLOYMENT.md](./DEPLOYMENT.md)
`app.*` = клиенты, `admin.*` = владелец.

## Поддомены

| URL | Кто |
|-----|-----|
| `app.*` / localhost:5173 | Клиент |
| `admin.*` / localhost:5174 | Владелец (отдельный бандл) |

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
