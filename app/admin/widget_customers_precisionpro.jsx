import { supabase } from "@/utils/supabase/_server";

// Precision Pro — current-month membership counts by status.
// Replaces the old `widget_pivot_count_precisionpro` table.
// Mirrors widget_customers_signalscout.jsx but filtered to Precision Pro.
const date = new Date();
const currentYear = date.getFullYear();
const currentMonth = date.getMonth() + 1;
const currentMonthName = date.toLocaleString("default", { month: "long" });

export default async function WidgetCustomersPrecisionPro() {
  const { data: counts, error: countsError } = await supabase
    .from("v_subscription_counts_by_plan")
    .select("plan_title, active_count, grace_count, expired_count, cancelled_count, pending_count")
    .eq("plan_title", "Precision Pro")
    .single();

  if (countsError || !counts) {
    console.error("Error fetching Precision Pro counts:", countsError);
    return (
      <div className="grid uppercase">
        <h3 className="text-2xl font-bold py-4">
          {currentMonthName} {currentYear}
        </h3>
        <div className="text-error p-4">Error loading Precision Pro data</div>
      </div>
    );
  }

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
            {counts.active_count ?? 0}
          </div>
          <div className="stat-desc"># Active Memberships</div>
        </div>

        <div className="stat place-items-center">
          <div className="stat-figure text-secondary"></div>
          <div className="stat-title font-bold text-secondary">Grace</div>
          <div className="stat-value text-amber-500">
            {counts.grace_count ?? 0}
          </div>
          <div className="stat-desc"># In Grace Period</div>
        </div>

        <div className="stat place-items-center">
          <div className="stat-figure text-secondary"></div>
          <div className="stat-title font-bold text-secondary">Expired</div>
          <div className="stat-value">{counts.expired_count ?? 0}</div>
          <div className="stat-desc"># Expired Memberships</div>
        </div>
      </div>
    </div>
  );
}
