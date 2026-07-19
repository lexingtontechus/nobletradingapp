import { supabase } from "@/utils/supabase/_server";

// Current-month revenue summary cards, one per plan.
// Replaces the old `widget_payments_summary` table.
// Now reads from `payment_transactions` (status='success') joined with `plans`,
// grouped by plan_title, summed in cents → dollars for display.
const date = new Date();
const currentYear = date.getFullYear();
const currentMonth = date.getMonth() + 1; // 1-12
const currentMonthName = date.toLocaleString("default", { month: "long" });
const monthStart = `${currentYear}-${currentMonth.toString().padStart(2, "0")}-01`;
const monthEnd = `${currentYear}-${(currentMonth + 1).toString().padStart(2, "0")}-01`;

export default async function WidgetPaymentsSummary() {
  // Fetch all successful payments this month, with their plan title.
  // Grouping is done client-side (Supabase doesn't support GROUP BY in the
  // PostgREST API; v_revenue_summary view does monthly grouping but we need
  // the current month only — fetching the rows and reducing is fine for a
  // dashboard with at most a few hundred payments/month).
  const { data: payments, error } = await supabase
    .from("payment_transactions")
    .select(
      "amount_cents, is_renewal, plan_id, plans!inner(title)"
    )
    .eq("status", "success")
    .gte("paid_at", monthStart)
    .lt("paid_at", monthEnd);

  if (error) {
    console.error("Error fetching payments summary:", error);
    return <div className="text-error p-4">Error loading revenue summary</div>;
  }

  // Reduce into per-plan totals.
  const byPlan = new Map();
  for (const p of payments ?? []) {
    const title = p.plans?.title ?? "Unknown";
    const entry = byPlan.get(title) ?? {
      title,
      count: 0,
      revenue_cents: 0,
      renewals: 0,
      new_subscriptions: 0,
    };
    entry.count += 1;
    entry.revenue_cents += p.amount_cents ?? 0;
    if (p.is_renewal) entry.renewals += 1;
    else entry.new_subscriptions += 1;
    byPlan.set(title, entry);
  }

  const summary = Array.from(byPlan.values()).sort((a, b) =>
    a.title.localeCompare(b.title)
  );

  if (summary.length === 0) {
    return (
      <div className="py-4">
        <h2 className="text-xl font-bold py-4">
          Revenue {currentMonthName} {currentYear}
        </h2>
        <div className="stats shadow bg-base-200 border-base-100">
          <div className="stat place-items-center">
            <div className="stat-title font-bold text-secondary">No revenue</div>
            <div className="stat-value text-muted-foreground">$0</div>
            <div className="stat-desc">No successful payments this month</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="py-4">
      <h2 className="text-xl font-bold py-4">
        Revenue {currentMonthName} {currentYear}
      </h2>
      <div className="grid uppercase">
        <div className="stats shadow bg-base-200 border-base-100">
          {summary.map((item, id) => (
            <div key={id} className="stat place-items-center">
              <div className="stat-figure text-info badge badge-accent">
                {item.count}
              </div>
              <div className="stat-title font-bold text-secondary">
                {item.title}
              </div>
              <div className="stat-value text-emerald-700">
                ${(item.revenue_cents / 100).toLocaleString("en-US", {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0,
                })}
              </div>
              <div className="stat-desc capitalize">
                {item.new_subscriptions} new · {item.renewals} renewals
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
