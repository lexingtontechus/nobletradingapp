{
  user.publicMetadata.discord == "no" &&
  user.publicMetadata.planname == "no" &&
  user.publicMetadata.planstatus == "expired" ? (
    <li className="list-row">
      <div>
        <img className="size-12 rounded-box bg-white" src="/logoBitcoin.svg" />
      </div>
      <div className="list-col-grow">
        <div className="text-lg">Wealth Nation Subscription plan.</div>
        <div className="text-xs uppercase font-semibold opacity-60">
          You will need to be a Discord member for 15mins before we send you can
          subscribe to a plan.
        </div>
        <div className="list-col-wrap text-xl py-2">
          We use Now Payments, a recurring subscription platform that will
          invoice you at monthly intervals.
          <br />
          You can cancel your subscription at any time. There are no refunds or
          chargebacks for cancelled subscriptions.
        </div>
      </div>
      <div disabled="disabled" className="btn btn-block w-40 uppercase">
        Subscribe
      </div>
    </li>
  ) : (
    <div>
      <li className="p-4 pb-2 text-xl">Choose a plan</li>
      <li className="list-row">
        <div className="text-xl font-bold text-accent tabular-nums">$199</div>
        <div className="list-col-grow">
          <div className="text-lg">Wealth Nation Plan</div>
          <div className="text-xs uppercase font-semibold opacity-60">
            Price : $199/mth
          </div>
          <div className="py-2 list-col-wrap text-xl">Plan details</div>
        </div>
        <div className="flex-end">
          <Plan1 />
        </div>
      </li>
      <li className="list-row">
        <div className="text-xl font-bold text-accent tabular-nums">$499</div>
        <div className="list-col-grow">
          <div className="text-lg">Platinum Nation Plan</div>
          <div className="text-xs uppercase font-semibold opacity-60">
            Price : $499/mth
          </div>
          <div className="py-2 list-col-wrap text-xl">Plan details</div>
        </div>
        <div className="flex-end">
          <Plan1 />
        </div>
      </li>
    </div>
  );
}
