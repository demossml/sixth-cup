# SMS OTP (SMS Aero)

```
PWA → POST /api/auth/send-code → OTP service → SmsProvider → SmsAero / Mock
PWA → POST /api/auth/verify → hash check → user + JWT
```

## Providers

| SMS_PROVIDER | Когда |
|--------------|--------|
| `mock` | dev / тесты, SMS не уходит, `devCode` в ответе |
| `smsaero` | production, реальная SMS |

## Env (только backend, не в git)

```env
SMS_PROVIDER=smsaero
SMS_AERO_EMAIL=your@email.ru
SMS_AERO_API_KEY=   # из кабинета SMS Aero — НЕ коммитить
SMS_AERO_SENDER=67Coffee
```

Имя отправителя (`sign`) должно быть разрешено в кабинете SMS Aero.

## Mac mini

1. В `backend/.env` указать email, API key, sender.  
2. `SMS_PROVIDER=smsaero`  
3. Перезапустить API.  
4. Запросить код на свой номер с `app.*`.

## Безопасность

- OTP в БД хранится как **SHA-256** (не plaintext).  
- TTL 5 мин, cooldown ~45 с, лимиты на номер/IP, 5 неверных попыток.  
- В логах нет OTP и API key; телефон маскируется.

## Смена провайдера

Реализовать новый класс `SmsProvider` и выбрать через `SMS_PROVIDER`.
