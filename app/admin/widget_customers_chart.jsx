import { createClient } from "@/utils/supabase/server";
import BarChartCustomersSignalScout from "./components/barchart_customers_signalscout.jsx";
import BarChartCustomersPrecisionPro from "./components/barchart_customers_precisionpro.jsx";

export default async function WidgetCustomersChart() {
  const supabase = await createClient();

  // ── date helpers ───────────────────────────────────────────
  const today = new Date();
  const startOfYear = new Date(today.getFullYear(), 1, 1)
    .toISOString()
    .split("T")[0]; // YYYY-MM-01
  const endOfYear = new Date(today.getFullYear(), 12, 31)
    .toISOString()
    .split("T")[0]; // YYYY-MM-01

  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString()
    .split("T")[0]; // YYYY-MM-01
  const startOfNextMonth = new Date(
    today.getFullYear(),
    today.getMonth() + 1,
    1
  )
    .toISOString()
    .split("T")[0]; // first day of next month
  // ───────────────────────────────────────────────────────────

  // counts per status
  const { data: countSignalScout, error: signalscoutError } = await supabase
    .from("widget_pivot_count_signalscout")
    .select("*")
    .gte("date", startOfMonth) //startOfYear)
    .lt("date", startOfNextMonth); //endOfYear);

  const { data: countPrecisionPro, error: precisionproError } = await supabase
    .from("widget_pivot_count_precisionpro")
    .select("*")
    .gte("date", startOfMonth)
    .lt("date", startOfNextMonth);

  // monetary totals
  const totalActive =
    countSignalScout?.reduce((sum, i) => sum + i.active, 0) ?? 0;
  const totalExpired =
    countSignalScout?.reduce((sum, i) => sum + i.expired, 0) ?? 0;
  const totalRenewed =
    countSignalScout?.reduce((sum, i) => sum + i.waiting, 0) ?? 0;

  return (
    <div className="container mx-auto">
      <h1 className="text-3xl font-bold tracking-tight">
        Memberships Overview
      </h1>
      <p className="text-muted-foreground">
        Year-to-date {new Date().getFullYear()}
      </p>

      <BarChartCustomersSignalScout data={countSignalScout ?? []} />
      <BarChartCustomersPrecisionPro data={countPrecisionPro ?? []} />
    </div>
  );
}
