import { createClient } from "@/utils/supabase/server";

const date = new Date();
const currentYear = date.getFullYear();
const currentMonth = date.getMonth() + 1; // getMonth() returns 0-11, so add 1
const currentMonthName = date.toLocaleString("default", { month: "long" });

export default async function WidgetCustomersPrecisionPro() {
  const supabase = await createClient();

  const { data: widget_pivot_count_precisionpro } = await supabase
    .from("widget_pivot_count_precisionpro")
    .select("*")
    //.eq("title", "Signal Scout");
    .order("date", { ascending: false }, "status")
    .filter(
      "date",
      "gte",
      `${currentYear}-${currentMonth.toString().padStart(2, "0")}-01`
    )
    .filter(
      "date",
      "lt",
      `${currentYear}-${(currentMonth + 1).toString().padStart(2, "0")}-01`
    );

  // Calculate totals for the summary
  const currentCustomersNew = widget_pivot_count_precisionpro.reduce(
    (sum, item) => sum + (item.active ?? 0),
    0
  );
  const currentCustomersExpired = widget_pivot_count_precisionpro.reduce(
    (sum, item) => sum + (item.expired ?? 0),
    0
  );
  const currentCustomersRenewed = widget_pivot_count_precisionpro.reduce(
    (sum, item) => sum + (item.renewed ?? 0),
    0
  );

  return (
    <div className="grid uppercase">
      <h3 className="text-2xl font-bold py-4">
        {currentMonthName} {currentYear}
      </h3>
      <div className="stats bg-base-200 border-base-100 shadow">
        <div className="stat place-items-center">
          <div className="stat-figure text-secondary"></div>
          <div className="stat-title font-bold text-secondary">Active</div>
          <div className="stat-value text-emerald-700">
            {currentCustomersNew}
          </div>
          <div className="stat-desc"># Active Memberships</div>
        </div>

        <div className="stat place-items-center">
          <div className="stat-figure text-secondary"></div>
          <div className="stat-title font-bold text-secondary">Expired</div>
          <div className="stat-value">{currentCustomersExpired}</div>
          <div className="stat-desc"># Expired Memberships</div>
        </div>

        <div className="stat place-items-center">
          <div className="stat-figure text-secondary"></div>
          <div className="stat-title font-bold text-secondary">Renewed</div>
          <div className="stat-value text-emerald-700">
            {currentCustomersRenewed}
          </div>
          <div className="stat-desc"># Renewed Memberships</div>
        </div>
      </div>
    </div>
  );
}
