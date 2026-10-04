# Этап 1: облако Эвотор → app.67coffee.ru

## Владелец (кабинет)

1. dev.evotor.ru → приложение → **Интеграция** → проксирование запросов.
2. Маска URL: `https://app\.67coffee\.ru/api/.*`
3. Тип авторизации: **Ваш токен** = значение `EVOTOR_PROXY_TOKEN` из `backend/.env` на сервере.
4. Активировать приложение в ЛК, установить на кассу (Маркет или ADB после активации).
5. `versionCode` APK должен быть больше предыдущего в кабинете.

## Сервер

```bash
# в backend/.env
EVOTOR_PROXY_TOKEN='длинный_случайный_секрет'
EVOTOR_PROXY_ENFORCE=0   # сначала soft; после проверки enroll поставьте 1
```

Перезапуск API. Проверка:

```bash
curl -sS https://app.67coffee.ru/api/devices/ping
# без токена при ENFORCE=0 — ok; при ENFORCE=1 — 403

curl -sS -H "Authorization: Bearer $EVOTOR_PROXY_TOKEN" https://app.67coffee.ru/api/devices/ping
# {"ok":true,"proxy":{"authOk":true,...}}
```

## Caddy (журнал только app.67coffee.ru)

В блок `app.67coffee.ru` добавить (пример):

```
app.67coffee.ru {
  log {
    output stdout
    format json
  }
  encode zstd gzip
  reverse_proxy 172.18.0.1:3001
}
```

После `caddy reload` / restart контейнера — при enroll через облако в логах должны появиться запросы с IP `185.170.204.x` и `User-Agent: Evotor-HttpClient`.

## Android Stage 1

- `API_BASE_URL=https://app.67coffee.ru` (release не даёт менять URL)
- `usesCleartextTraffic=false`
- таймауты 4/8/9 с
- enroll: `publicKey` необязателен
- токен кассы: `X-Device-Token` (не `Authorization`)

## Ошибка «Hostname not verified»

Прямой HTTPS с терминала на ваш cert часто ломается; через **прокси Эвотора** после маски запрос идёт иначе. Повторите enroll **после** пунктов владельца.
