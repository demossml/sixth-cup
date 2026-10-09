# Fix: cups from Evotor commodityUuid + money scale

## Root cause (live API dump 2026-10-09)
REGISTER_POSITION uses commodityUuid, not productUuid.
SellHandler never matched product_store_links → cups_counted=0 always.

## Fix
- productUuid(): commodityUuid first
- number(): parse numeric strings (closeSum is a string)
- amountKopecks(): unit price >= 1000 → already kopecks; else rubles×100
- cups: only REGISTER_POSITION / POSITION lines

## After deploy
New SELL with Americano (counts_as_cup=1) must increase cards.paid_total.
