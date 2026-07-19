"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { LineChart } from "@tremor/react";

export default function RealtimeChart() {
  const supabase = createClient();
  const [payments, setPayments] = useState(null);

  useEffect(() => {
    const { data: widget_payments_precisonpro } = supabase
      .from("widget_payments_precisonpro")
      .select("*")
      .order("month", { ascending: false }, "status");
    if (data) {
      setPayments(widget_payments_precisonpro);
    }
  }, [supabase]);

  const formatTime = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const chartData = payments.map((item, id) => ({
    date: formatTime(item.updated_at) || `Point ${id + 1}`,
    Total: item.amount,
  }));

  return (
    <LineChart
      className="h-80 w-full"
      data={chartData}
      index="date"
      categories={["Amount"]}
      showAnimation={true}
      valueFormatter={(number) => `$${Intl.NumberFormat("us").format(number)}`}
    />
  );
}
