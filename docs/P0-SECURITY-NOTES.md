# P0 security (после аудита)

Сделано:
- requireAuth: 401 если user удалён
- recipe* убраны из публичного GET /api/directory; касса: GET /api/directory/staff + X-Device-Token
- POST /auth/guest: rate limit IP, clientNonce идемпотентность 10 мин
- SMS /send-code /verify только NODE_ENV=development
- WELCOME после первой оплаты (dp>0), не при создании гостя
- «Выйти» → двойной confirm, текст про потерю доступа

Ещё не сделано (P0/P1 backlog):
- recovery QR/код
- динамический QR карты
- public_id вместо phone column
- antifraud рефералов глубже
- админ 2FA на reset
