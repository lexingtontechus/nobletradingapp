import { supabase } from "@/utils/supabase/server";
//import ChartPrecisionPro from "./components/chart_precisionpro";
import Example from "./components/example";

//return data.json();

export default async function WidgetPaymentsPrecisionProChart() {
  const formatTime = (dateString) => {
    const date = new Date(dateString);
    return date.toDateString([], { year: "numeric", month: "short" });
    //toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const { data } = await supabase
    .from("widget_payments")
    .select("updated_at,status,amount")
    .eq("title", "Precision Pro");
  //.order("month", { ascending: false }, "status");
  //.eq("month");

  //if (data) return JSON.stringify(data);

  //const tempdata = JSON.stringify(widget_payments);

  const chartData = data.map((item, id) => ({
    date: formatTime(item.updated_at) || `Point ${id + 1}`,
    amount: item.amount,
    name: item.status,
  }));

  return (
    <>
      <Example />
      {/*chartData={chartData}*/}
    </>
  );
}
