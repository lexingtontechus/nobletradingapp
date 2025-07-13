import { useState } from "react";
//import NPPlans from "./npplan";
import Plan1 from "./plan1";
import Plan2 from "./plan2";
import Logo from "./logo";

export default function Plans({ useremail, user }) {
  //const [discord, setDiscord] =;
  //const [planstatus, setPlanStatus] = useState("");

  return (
    <>
      {user.publicMetadata.discord == "false" &&
      //user.publicMetadata.planname == "no" &&
      user.publicMetadata.planstatus == "false" ? (
        //discord == "no" && planstatus == "expired" ? (

        <li className="list-row">
          <div>
            <Logo size={12} />
          </div>
          <div className="list-col-grow">
            <div className="text-lg">Nobel Trading Membership plans.</div>
            <div className="text-xs uppercase font-semibold opacity-60">
              You will need to be a Discord member for 15mins before we send you
              can subscribe to a plan.
            </div>
            <div className="list-col-wrap text-xl py-2">
              Our Membership Subscriptions are powered by{" "}
              <span className="text-accent"> Now Payments</span> - a recurring
              subscription platform that will invoice you at monthly intervals.
              <br />
              You can cancel your subscription at any time. There are no refunds
              or chargebacks for cancelled subscriptions.
            </div>
          </div>
          <div disabled="disabled" className="btn btn-block w-40 uppercase">
            Subscribe
          </div>
        </li>
      ) : (
        <div>
          <li className="p-4 pb-2 text-xl">Choose a monthly membership plan</li>

          <li className="list-row">
            <div className="text-xl font-bold text-accent tabular-nums min-w-12">
              $79
            </div>
            <div className="list-col-grow">
              <div className="text-lg">Signal Scout</div>
              <div className="text-xs uppercase font-semibold opacity-60">
                Price : $79/mth
              </div>
              <div className="py-2 list-col-wrap text-xl">
                Entry-level traders
              </div>
            </div>
            <div className="flex-end">
              <Plan1 useremail={useremail} />
            </div>
          </li>
          <li className="list-row">
            <div className="text-xl font-bold text-accent tabular-nums min-w-12">
              $199
            </div>
            <div className="list-col-grow">
              <div className="text-lg">Precision Pro</div>
              <div className="text-xs uppercase font-semibold opacity-60">
                Price : $199/mth
              </div>
              <div className="py-2 list-col-wrap text-xl">
                Full access to our premium tools.
              </div>
            </div>
            <div className="flex-end">
              <Plan2 useremail={useremail} />
            </div>
          </li>
        </div>
      )}
    </>
  );
}
