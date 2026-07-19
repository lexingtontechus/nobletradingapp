import { supabase } from "@/utils/supabase/_server";
import { LineChartPayments } from "./components/linechart_payments";

// Year-to-date monthly revenue area chart (all plans combined).
// Replaces the old `widget_payments_chart` table.
// Now reads from the `v_revenue_summary` view, which groups successful
// payments by month + plan_title and returns: month, plan_title, payment_count,
// revenue_cents, renewals, new_subscriptions.
//
// The chart shows two stacked series: new-subscription revenue + renewal
// revenue (the old "active/expired/renewed" naming was misleading — in the
// new schema every payment is either an initial or a renewal).
export default async function WidgetPaymentsChart() {
  const currentYear = new Date().getFullYear();
  const yearStart = `${currentYear}-01-01`;
  const yearEnd = `${currentYear + 1}-01-01`;

  const { data, error } = await supabase
    .from("v_revenue_summary")
    .select("month, plan_title, payment_count, revenue_cents, renewals, new_subscriptions")
    .gte("month", yearStart)
    .lt("month", yearEnd)
    .order("month", { ascending: true });

  if (error) {
    console.error("Error fetching payments chart:", error);
    return <div className="text-error p-4">Error loading revenue chart</div>;
  }

  return (
    <div className="container mx-auto p-6">
      <LineChartPayments data={data ?? []} />
    </div>
  );
}
