//import { UserDetails } from "../components/user-details"
import { UserButton, Protect } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";

import WidgetCustomersSummary from "./widget_customers_summary";
import WidgetCustomersDetails from "./widget_customers_details";
import WidgetPaymentsSummary from "./widget_payments_summary";
import WidgetPaymentsSignalScout from "./widget_payments_signalscout";
import WidgetPaymentsPrecisionPro from "./widget_payments_precisionpro";
import WidgetPaymentsPrecisionProChart from "./widget_payments_precisionpro_chart";

export default async function NTAPage() {
  await auth.protect();

  return (
    <div className="container p-8 mx-auto py-2">
      {/* name of each tab group should be unique */}
      {/* name of each tab group should be unique */}
      <h2 className="font-bold text-2xl uppercase py-2">Admin Dashboard</h2>
      <div className="tabs tabs-box">
        <input
          type="radio"
          name="menu_tabs"
          className="tab"
          aria-label="Summary"
          defaultChecked
        />
        <div className="tab-content bg-base-100 border-base-300 p-6">
          Admin Dashboard
          <div className="grid">
            <WidgetCustomersSummary />
            <WidgetPaymentsSummary />
          </div>
        </div>

        <input
          type="radio"
          name="menu_tabs"
          className="tab"
          aria-label="Signal Scout"
        />
        <div className="tab-content bg-base-100 border-base-300 p-6">
          Signal Scout
          <WidgetPaymentsSignalScout />
        </div>

        <input
          type="radio"
          name="menu_tabs"
          className="tab"
          aria-label="Precision Pro"
        />
        <div className="tab-content bg-base-100 border-base-300 p-6">
          Precision Pro
          <WidgetPaymentsPrecisionProChart />
          <WidgetPaymentsPrecisionPro />
        </div>

        <input
          type="radio"
          name="menu_tabs"
          className="tab"
          aria-label="Customers"
        />
        <div className="tab-content bg-base-100 border-base-300 p-6">
          Customers
          <WidgetCustomersDetails />
        </div>
      </div>
    </div>
  );
}
