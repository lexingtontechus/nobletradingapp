# Archived admin widgets

These files were archived during the admin dashboard rewrite (Task: align admin
widgets with the new Supabase schema from migrations 0001–0005).

## What was here

| File | Why archived |
| --- | --- |
| `widget_customers_details.jsx` | Queried `widget_customers_details` table (does not exist in new schema). Import was already commented out in `page.jsx`. Not replaced — the detail view can be rebuilt later against `v_active_subscriptions` if needed. |
| `_ntawidget.jsx` | Queried `vwidget_customers` view (does not exist in new schema). Underscore prefix = private/dead. Not imported anywhere. |
| `components/realtime-chart.jsx` | Client component that polled `/api/nta/nta-data` (a mock random-data endpoint). Not imported anywhere. The new admin dashboard uses real Supabase data via server components instead of client-side polling. |

## How to roll back

If you need any of these back:
1. Move the file out of `_archive/` back to its original location.
2. Recreate the underlying table/view it queried (see the original migration
   history before the 0001_init redesign).
3. Re-add the import to `app/admin/page.jsx` if applicable.

**Recommended:** don't roll back. The new widgets in the parent directory query
the real `users`, `payment_transactions`, `subscriptions` tables + `v_revenue_summary`
+ `v_subscription_counts_by_plan` views and are wired to the current schema.
