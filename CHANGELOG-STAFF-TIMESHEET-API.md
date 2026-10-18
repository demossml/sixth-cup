# Staff / timesheet / wishes / breaks API (additive)

## DB
- migration `021_staff_timesheet.sql`

## Device (касса, `/api/devices`)
- GET `/shift/summary`
- GET `/shift/team`
- GET `/timesheet?month=YYYY-MM`
- GET `/timesheet/wishes?month=YYYY-MM`
- PUT `/timesheet/wishes`
- GET `/shift/breaks`
- POST `/shift/breaks/start`
- POST `/shift/breaks/end`

## Admin (`/api/admin`)
- GET/POST `/staff`
- DELETE `/staff/:id`
- PUT `/staff/:id/device`
- GET/PUT `/staff/schedule`
- GET/POST `/staff/wish-rules`
- GET `/staff/wishes`
- PUT `/staff/wishes/:id`

## Admin UI
- page `/staff` «Сотрудники и табель» in More menu

Does not change loyalty, catalog, sell, or existing admin modules.
