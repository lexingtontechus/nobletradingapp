import Logo from "./logo";

export default function ActiveUser({ user }) {
  const NTA_PLAN1 = process.env.NEXT_PUBLIC_NTA_PLAN1;
  const NTA_PLAN2 = process.env.NEXT_PUBLIC_NTA_PLAN2;
  return (
    <>
      <li className="list-row">
        <div>
          <Logo size={12} />
        </div>
        <div className="list-col-grow">
          <div className="text-lg">{user.publicMetadata.planname}</div>
          {user.publicMetadata.planid == NTA_PLAN1 && (
            <div className="text-xs uppercase font-semibold opacity-60">
              Plan Name : Signal Scout
            </div>
          )}
          {user.publicMetadata.planid == NTA_PLAN2 && (
            <div className="text-xs uppercase font-semibold opacity-60">
              Plan Name : Precision Pro
            </div>
          )}
          <div className="list-col-wrap text-xl py-2">
            We use Now Payments, a recurring subscription platform that will
            invoice you at monthly intervals.
            <br />
            You will receive a monthly email notification to resubscribe to your
            membership plan. If you do not resubscribe, your membership will
            expire.
            <br />
            There are no refunds or chargebacks for paid subscriptions.
          </div>
        </div>
        {user.publicMetadata.planstatus == "true" && (
          <div disabled="disabled" className="btn btn-block w-40 uppercase">
            ACTIVE
          </div>
        )}
      </li>
    </>
  );
}
