import { supabase } from "@/utils/supabase/server";
//import Chart from "./chart";
import Example from "./example";
export default async function Chart_PrecisionPro({ params }) {
  const formatTime = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const { data: widget_payments } = await supabase
    .from("widget_payments")
    .select("*")
    .eq("title", "Precision Pro");
  //.order("month", { ascending: false }, "status");

  //.eq("month");

  const chartData = widget_payments.map((item, id) => ({
    date: formatTime(item.updated_at) || `Point ${id + 1}`,
    Total: item.amount,
  }));

  const Categories = widget_payments.map((item, id) => ({
    Categories: item.status,
  }));

  return (
    <>
      <Example chartData={chartData} />
    </>
  );
}
