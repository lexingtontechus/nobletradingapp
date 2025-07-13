import { supabase } from "@/utils/supabase/server";

// Create a single supabase client for interacting with your database

export default async function WidgetPaymentsprecisonpro() {
  //const supabase = await createClient();

  const { data: widget_payments_precisionpro } = await supabase
    .from("widget_payments_precisionpro")
    .select("*")
    //.eq("title", "Precision Pro");
    .order("month", { ascending: false }, "status");

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
          {widget_payments_precisionpro.map((item, id) => (
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
