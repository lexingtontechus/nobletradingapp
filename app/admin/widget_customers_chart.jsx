import { supabase } from "@/utils/supabase/_server";
import BarChartCustomersSignalScout from "./components/barchart_customers_signalscout.jsx";
import BarChartCustomersPrecisionPro from "./components/barchart_customers_precisionpro.jsx";

// Memberships overview — monthly new-subscriber counts per plan, year-to-date.
// Replaces the old `widget_pivot_count_signalscout` + `widget_pivot_count_precisionpro`
// tables (which had per-day active/expired/renewed counts — a shape that no
// longer exists in the new schema).
//
// The new schema tracks subscriptions via `subscriptions.created_at` (when the
// pending row was created) and `payment_transactions.paid_at` (when each
// payment succeeded). We chart new subscribers per month = distinct users
// whose first successful payment fell in that month, per plan.
//
// For a simpler, equally useful metric we use `payment_transactions` filtered
// to is_renewal = false (initial payments only) grouped by month + plan.
export default async function WidgetCustomersChart() {
  const today = new Date();
  const yearStart = `${today.getFullYear()}-01-01`;
  const yearEnd = `${today.getFullYear() + 1}-01-01`;

  // Fetch all initial (non-renewal) successful payments YTD, with plan title.
  const { data: initialPayments, error } = await supabase
    .from("payment_transactions")
    .select("paid_at, is_renewal, plans!inner(title)")
    .eq("status", "success")
    .eq("is_renewal", false)
    .gte("paid_at", yearStart)
    .lt("paid_at", yearEnd);

  if (error) {
    console.error("Error fetching memberships overview:", error);
    return (
      <div className="container mx-auto">
        <h1 className="text-3xl font-bold tracking-tight">
          Memberships Overview
        </h1>
        <div className="text-error p-4">Error loading memberships overview</div>
      </div>
    );
  }

  // Group by YYYY-MM + plan_title → count.
  const buckets = new Map(); // key: `${month}|${plan_title}`
  for (const p of initialPayments ?? []) {
    const month = (p.paid_at ?? "").slice(0, 7); // YYYY-MM
    const title = p.plans?.title ?? "Unknown";
    const key = `${month}|${title}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  // Pivot into per-plan arrays for the two bar charts.
  const months = new Set();
  for (const key of buckets.keys()) months.add(key.split("|")[0]);
  const sortedMonths = Array.from(months).sort();

  const buildSeries = (planTitle) =>
    sortedMonths.map((m) => ({
      date: `${m}-01`, // first-of-month for chart X-axis parsing
      active: buckets.get(`${m}|${planTitle}`) ?? 0,
      expired: 0, // reserved for chart compatibility (not used in new schema)
    }));

  const signalScoutData = buildSeries("Signal Scout");
  const precisionProData = buildSeries("Precision Pro");

  return (
    <div className="container mx-auto">
      <h1 className="text-3xl font-bold tracking-tight">
        Memberships Overview
      </h1>
      <p className="text-muted-foreground">
        Year-to-date {new Date().getFullYear()} — new subscribers per month
      </p>

      <BarChartCustomersSignalScout data={signalScoutData} />
      <BarChartCustomersPrecisionPro data={precisionProData} />
    </div>
  );
}
