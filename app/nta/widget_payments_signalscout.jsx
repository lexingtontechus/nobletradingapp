import { supabase } from "@/utils/supabase/server";

// Create a single supabase client for interacting with your database

export default async function WidgetPaymentsSignalScout() {
  //const supabase = await createClient();

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

  const { data: widget_payments_signalscout } = await supabase
    .from("widget_payments_signalscout")
    .select("*")
    .order("month", { ascending: false }, "status");

  //.eq("month");
  return (
    <div className="overflow-x-auto uppercase">
      <table className="table">
        {/* head */}
        <thead>
          <tr className="text-secondary">
            <th className="w-64">Month</th>
            <th className="w-32">Amount</th>
            <th className="w-32">Status</th>
          </tr>
        </thead>

        {/* row 1 {monthNames[d.getMonth()]} */}

        <tbody>
          {widget_payments_signalscout.map((item, id) => (
            <tr key={id} className="hover:bg-base-300">
              <th className="w-64">{item.monthname}</th>
              <td className="w-32">${item.amount}</td>
              <th className="w-32">{item.status}</th>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
