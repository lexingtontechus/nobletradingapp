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

import { supabase } from "@/utils/supabase/server";

// Create a single supabase client for interacting with your database

export default async function WidgetPaymentsSummary() {
  // const supabase = await createClient();

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const d = new Date();
  const m = new Date().getMonth;

  const { data: widget_payments_summary } = await supabase
    .from("widget_payments_summary")
    .select("*")
    .eq("month", "7");

  return (
    <div>
      <h2 className="text-xl font-bold">
        {monthNames[d.getMonth()]} {new Date().getFullYear()}
      </h2>
      {widget_payments_summary.map((item, id) => (
        <div key={id} className="stats shadow max-w-128">
          {/* {monthNames[d.getMonth()]} {new Date().getFullYear()}*/}
          <div className="stat w-64">
            <div className="stat-figure text-secondary badge badge-info">
              {item.count}
            </div>
            <div className="stat-title font-bold text-secondary">
              {item.title}
            </div>
            <div className="stat-value text-emerald-700">${item.amount}</div>
            <div className="stat-desc">{item.status}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
