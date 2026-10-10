# Admin redesign — full plan coverage (UI)

## Added / completed vs partial drop

### Menu (phase 2)
- **Create product** modal: name, price, group, modifier scheme, recipe, image URL, tax, measure, cost, countsAsCup, freeEligible, store checkboxes
- **Edit product** same form via POST /products (existing API)
- **Hide product** DELETE
- Bulk available / countsAsCup
- Filters: all / on / off / cup / sync error
- **Groups** CRUD page `#/menu/groups`
- **Modifiers + schemes** page `#/menu/modifiers`

### Marketing (phase 3)
- Create / list / delete promos
- Grant voucher one customer + grant-all

### System
- Logs + audit
- Dangerous zone reset with word RESET (server still needs ADMIN_ALLOW_RESET=1)

### Still secondary / Legacy
- Complex modifier-scheme item composition (wire items to scheme) — if API needs multi-step, use Legacy
- Evotor drift/wipe UI buttons (API exists; wipe remains careful via Legacy or later)
- Perfect Shopify DataTable density modes

SQL fixes from admin-sql-fix included if present in this tree.
