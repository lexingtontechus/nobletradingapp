import { useState } from "react";
import Logo from "./logo";
import CheckoutSignalScout from "./checkoutsignalscout";
import CheckoutPrecisionPro from "./checkoutprecisionpro";
import { createClient } from "@/utils/supabase/client";
import { MarkdownRenderer } from "./markdownrender";

const supabase = await createClient();

const { data, error } = await supabase
  .from("plans")
  .select("*")
  .eq("status", true)
  .eq("plantype", "subscription");

export default function Plans({ useremail, user }) {
  //const [discord, setDiscord] =;
  //const [planstatus, setPlanStatus] = useState("");
  const NTA_PRECISIONPRO = process.env.NEXT_PUBLIC_NTA_PRECISIONPRO;

  return (
    <>
      {user?.publicMetadata.discord == "false" &&
      //user.publicMetadata.planname == "no" &&
      user?.publicMetadata.plantitle == "false" ? (
        //discord == "no" && planstatus == "expired" ? (
        <div className="">
          <div className="text-lg">Noble Trading Membership plans.</div>
          <div className="text-xs uppercase font-semibold opacity-60">
            Get access to trade information after you have joined our Discord
            community.
          </div>
          <div className="text-xl py-2">
            Our Membership Subscriptions are powered by
            <span className="text-accent"> Hel.io Payments</span> - a recurring
            billing platform that will invoice you at monthly intervals.
          </div>

          <div
            disabled="disabled"
            className="hidden btn btn-block w-40 uppercase"
          >
            Subscribe
          </div>
        </div>
      ) : (
        <>
          <div className="py-4 text-xl">Choose a monthly membership plan</div>

          <div className="flex flex-wrap gap-4">
            {data.map((item) => (
              <div
                key={item.id}
                className="card card-bordered bg-base-300 w-96"
              >
                <div className="card-body">
                  {item.plan_id == NTA_PRECISIONPRO ? (
                    <span className="badge badge-sm badge-secondary">
                      Most Popular
                    </span>
                  ) : (
                    <span className="py-3"></span>
                  )}
                  <div className="flex justify-between">
                    <h2 className="uppercase text-3xl font-bold">
                      {item.title}
                    </h2>
                    <span className="text-xl text-emerald-500">
                      ${item.amount}/mth
                    </span>
                  </div>
                  <MarkdownRenderer
                    content={item.description}
                    className="text-md text-muted-foreground space-y-2"
                  />
                  <div className="card-actions justify-end">
                    {item.plan_id == NTA_PRECISIONPRO ? (
                      <CheckoutPrecisionPro />
                    ) : (
                      <CheckoutSignalScout />
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
