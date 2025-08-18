import {
  TrendingUp,
  TrendingDown,
  Users,
  DollarSign,
  ShoppingCart,
  Target,
  Wifi,
  WifiOff,
} from "lucide-react";

import { createClient } from "@/utils/supabase/server";

const date = new Date();
const currentYear = date.getFullYear();
const currentMonth = date.getMonth() + 1; // getMonth() returns 0-11, so add 1
const currentMonthName = date.toLocaleString("default", { month: "long" });

export default async function WidgetPaymentsSummary() {
  const supabase = await createClient();

  const { data: widget_payments_summary } = await supabase
    .from("widget_payments_summary")
    .select("*")
    .order("title", "status", { ascending: true })
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
  //    .limit(30);

  return (
    <div className="py-4">
      <h2 className="text-xl font-bold py-4">
        Revenue {currentMonthName} {currentYear}
      </h2>
      <div className="grid uppercase">
        <div className="stats shadow bg-base-200 border-base-100 shadow">
          {widget_payments_summary.map((item, id) => (
            <div key={id} className="stat place-items-center">
              <div className="stat-figure text-info badge badge-accent">
                {item.count}
              </div>
              <div className="stat-title font-bold text-secondary">
                {item.title}
              </div>
              <div className="stat-value text-emerald-700">
                ${item.amount / 100000}
              </div>
              <div className="stat-desc capitalize">{item.status}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
