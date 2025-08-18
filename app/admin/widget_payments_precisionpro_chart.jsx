import { createClient } from "@/utils/supabase/server";
//import { AnalyticsChart } from "./components/analytics-chart";
import { LineChartPrecisionPro } from "./components/linechart_precisionpro";

export default async function WidgetPaymentsPrecisonProChart() {
  const supabase = await createClient();

  // Fetch analytics data from Supabase
  const { data: PaymentsPrecisionPro, error } = await supabase
    .from("widget_payments_chart_details")
    .select("date,active,expired,renewed")
    .eq("title", "Precision Pro")
    .order("date", { ascending: true })
    .limit(30);

  if (error) {
    console.error("Error fetching analytics:", error);
    return <div>Error loading analytics data</div>;
  }

  return (
    <div className="container mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          Precision Pro Payments
        </h1>
      </div>

      <LineChartPrecisionPro data={PaymentsPrecisionPro || []} />
    </div>
  );
}
