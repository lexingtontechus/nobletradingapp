import { createClient } from "@/utils/supabase/server";
import { LineChartPayments } from "./components/linechart_payments";

export default async function Customers() {
  const supabase = await createClient();

  // Fetch analytics data from Supabase
  const { data: currentPayments, error } = await supabase
    .from("widget_payments_chart")
    .select("date,active,expired,renewed")
    //.eq("title", "Precision Pro")
    .order("date", { ascending: true });

  //.lt("date", startOfYearDate); //  < first day of next month
  //.order("date", { ascending: true })
  //.limit(30)

  if (error) {
    console.error("Error fetching payments:", error);
    return <div>Error loading payment data</div>;
  }

  return (
    <div className="container mx-auto p-6">
      <LineChartPayments data={currentPayments || []} />
    </div>
  );
}
