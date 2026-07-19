import { supabase } from "@/utils/supabase/_server";
import { LineChartPrecisionPro } from "./components/linechart_precisionpro";

// Precision Pro — year-to-date monthly revenue area chart.
// Replaces the old `widget_payments_chart_details` table filtered by title.
// Now reads from the `v_revenue_summary` view filtered to plan_title.
export default async function WidgetPaymentsPrecisonProChart() {
  const currentYear = new Date().getFullYear();
  const yearStart = `${currentYear}-01-01`;
  const yearEnd = `${currentYear + 1}-01-01`;

  const { data, error } = await supabase
    .from("v_revenue_summary")
    .select("month, plan_title, payment_count, revenue_cents, renewals, new_subscriptions")
    .eq("plan_title", "Precision Pro")
    .gte("month", yearStart)
    .lt("month", yearEnd)
    .order("month", { ascending: true });

  if (error) {
    console.error("Error fetching Precision Pro revenue:", error);
    return <div className="text-error p-4">Error loading Precision Pro revenue</div>;
  }

  return (
    <div className="container mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          Precision Pro Payments
        </h1>
      </div>
      <LineChartPrecisionPro data={data ?? []} />
    </div>
  );
}
