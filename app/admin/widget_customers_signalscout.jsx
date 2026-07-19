import { supabase } from "@/utils/supabase/_server";

// Signal Scout — current-month membership counts by status.
// Replaces the old `widget_pivot_count_signalscout` table.
// Now reads from the `v_subscription_counts_by_plan` view (one row per plan
// with pending/active/grace/expired/cancelled counts) for the funnel,
// plus `subscriptions` for the current-period active count.
const date = new Date();
const currentYear = date.getFullYear();
const currentMonth = date.getMonth() + 1;
const currentMonthName = date.toLocaleString("default", { month: "long" });

export default async function WidgetCustomersSignalScout() {
  // v_subscription_counts_by_plan gives lifetime counts per plan × status.
  const { data: counts, error: countsError } = await supabase
    .from("v_subscription_counts_by_plan")
    .select("plan_title, active_count, grace_count, expired_count, cancelled_count, pending_count")
    .eq("plan_title", "Signal Scout")
    .single();

  if (countsError || !counts) {
    console.error("Error fetching Signal Scout counts:", countsError);
    return (
      <div className="grid uppercase">
        <h3 className="text-2xl font-bold py-4">
          {currentMonthName} {currentYear}
        </h3>
        <div className="text-error p-4">Error loading Signal Scout data</div>
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
