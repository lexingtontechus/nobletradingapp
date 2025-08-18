import { createClient } from "@/utils/supabase/server";
//import { AnalyticsChart } from "./components/analytics-chart";
import { LineChartSignalScout } from "./components/linechart_signalscout";

export default async function WidgetPaymentsSignalScoutChart() {
  const supabase = await createClient();

  // Fetch analytics data from Supabase
  const { data: PaymentsSignalScout, error } = await supabase
    .from("widget_payments_chart_details")
    .select("date,active,expired,renewed")
    .eq("title", "Signal Scout")
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
          Signal Scout Payments
        </h1>
      </div>

      <LineChartSignalScout data={PaymentsSignalScout || []} />
    </div>
  );
}
