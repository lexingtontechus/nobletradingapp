import { checkRole } from "../../utils/roles";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

//Tab - Admin Dashboard
import WidgetCustomersSummary from "./widget_customers_summary";
import WidgetPaymentsSummary from "./widget_payments_summary";
import WidgetPaymentsChart from "./widget_payments_chart";

//Tab - SignalScout
import WidgetCustomersSignalScout from "./widget_customers_signalscout";
import WidgetPaymentsSignalScoutChart from "./widget_payments_signalscout_chart";

//Tab - PrecisionPro
import WidgetCustomersPrecisionPro from "./widget_customers_precisionpro";
import WidgetPaymentsPrecisionProChart from "./widget_payments_precisionpro_chart";

//Tab - Customers
import WidgetCustomersChart from "./widget_customers_chart";
//import WidgetCustomersDetails from "./widget_customers_details";

export default async function Admin() {
  // await auth.protect();
  const { has } = await auth();
  const isAdmin = await checkRole("admin");
  if (!isAdmin) {
    redirect("/");
  }
  //const { userId } = await auth.protect({ permission: "org:admin" });

  return (
    <div className="container p-8 mx-auto py-2">
      {/* name of each tab group should be unique */}
      {/* name of each tab group should be unique */}
      <h2 className="font-bold text-2xl uppercase py-2">Admin Dashboard</h2>
      <div className="tabs tabs-box">
        {/* Default Dashboard*/}
        <input
          type="radio"
          name="menu_tabs"
          className="tab"
          aria-label="Summary"
          defaultChecked
        />
        <div className="tab-content bg-base-100 border-base-300 p-6">
          <div className="grid">
            <h1 className="text-3xl font-bold tracking-tight">Overview </h1>
            <div className="container mx-auto p-4">
              <WidgetCustomersSummary />
              <WidgetPaymentsSummary />
              <WidgetPaymentsChart />
            </div>
          </div>
        </div>

        {/* Signal Scout*/}
        <input
          type="radio"
          name="menu_tabs"
          className="tab"
          aria-label="Signal Scout"
        />

        <div className="tab-content bg-base-100 border-base-300 p-6">
          <h1 className="text-3xl font-bold tracking-tight">
            Signal Scout Overview
          </h1>
          <div className="container mx-auto p-4">
            <WidgetCustomersSignalScout />
            <WidgetPaymentsSignalScoutChart />
          </div>
        </div>

        {/* Precision Pro*/}
        <input
          type="radio"
          name="menu_tabs"
          className="tab"
          aria-label="Precision Pro"
        />
        <div className="tab-content bg-base-100 border-base-300 p-6">
          <h1 className="text-3xl font-bold tracking-tight">
            Precision Pro Overview
          </h1>
          <div className="container mx-auto p-4">
            <WidgetCustomersPrecisionPro />
            <WidgetPaymentsPrecisionProChart />
          </div>
        </div>
        {/* Customer Details */}
        <input
          type="radio"
          name="menu_tabs"
          className="tab"
          aria-label="Memberships"
        />
        <div className="tab-content bg-base-100 border-base-300 p-6">
          <WidgetCustomersChart />
        </div>
      </div>
    </div>
  );
}
