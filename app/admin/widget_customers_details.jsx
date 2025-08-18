import { createClient } from "@/utils/supabase/server";

// Create a single supabase client for interacting with your database

export default async function WidgetCustomersDetails() {
  const supabase = await createClient();

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

  const { data: widget_customers_details } = await supabase
    .from("widget_customers_details")
    .select()
    .textSearch("subscriber_email", `'000@duck.com'`, {
      type: "plain",
      config: "english",
    });

  return (
    <div>
      <h2 className="text-xl font-bold">Customer Lookup </h2>
      {widget_customers_details.map((item, id) => (
        <div key={id} className="w-128">
          {item.subscriber_email}
          {item.title}${item.amount}
          {item.monthname}
        </div>
      ))}
    </div>
  );
}
