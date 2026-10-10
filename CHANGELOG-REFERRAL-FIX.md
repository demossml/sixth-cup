# Referral system fix (2026-10-10)

## Problem
`sc-invite` was written to localStorage when a `/?invite=` link was opened and **never removed**. `ensureGuest()` sent it
with every account creation, so after "Сбросить карту" (or any lost JWT) the new card could be bound to a stale referrer.
An unknown stale code was worse: the server answered 400 and the card could not be created at all.
Also: the card QR (for the till) and the invite QR (link) were not distinguishable; balances were floored to whole rubles.

## Client (frontend)
- `lib/invite.ts` (new, pure + unit-tested): invite is stored as `{code, at}`, expires after 14 days, legacy bare values are dropped,
  junk codes are rejected.
- `main.tsx`: the link is remembered **only when the browser has no account (no JWT)**; an existing account is never rebound.
  `?invite=` is always removed from the address bar.
- `ensureGuest.ts`: invite is cleared after the account is created; if the server says the code is unknown, it is dropped and the card
  is created without it (no more "cannot get a card"); on network failure the invite is kept for the next attempt.
  `restoreAccount` clears a pending invite.
- `ProfilePage.logout` clears the invite: a deliberately reset card starts clean.
- QR purposes: "QR карты — покажите кассиру" (alt "QR карты для кассы") vs "QR приглашения — покажите другу" (alt "QR приглашения друга") with explanations.
- `lib/money.ts` `formatRub(kopecks)`: 450 → "4,50", 400 → "4". Used for cashback on the card screen and profile and for "От друзей получено".

## Backend
- `auth/service.ts`: log line `guest registered user=<id> invitedBy=<id|-> withInvite=0|1` (internal ids only; never the code/tokens).
- `loyalty/cardLookup.ts`: `fromFriendsKopecks` added to the sync state (additive; `fromFriendsRub` kept for compatibility).
- Unchanged: invite binding (`users.invite_code` → `users.id` → `invited_by`), referral accrual in SellHandler / receipts / devices sales.

## Tests
`backend/src/__tests__/referral.test.ts` (client store + server binding + full scenario + log + money). backend 65 passed; typecheck/build green.
Live browser check (Playwright): link → bound once, URL cleaned, key consumed; reset → new card without referrer; existing account ignores a link;
legacy/unknown stored codes never block or attach.

## How to verify "invited_by = 4" on the server
`invited_by` is `users.id`, not a card number. SQL (read-only):
```sql
SELECT n.id, n.card_code, n.created_at, n.invited_by, p.card_code AS inviter_card_code
FROM users n LEFT JOIN users p ON p.id = n.invited_by
ORDER BY n.id DESC LIMIT 10;
```
If `inviter_card_code` is 12, the binding is correct (card 12 has internal id 4). Logs after deploy: `guest registered … invitedBy=…`.
Existing wrong bindings are not changed automatically.
