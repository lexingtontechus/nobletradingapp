import Logo from "./logo";

export default function ActiveUser({ user }) {
  const NTA_SIGNALSCOUT = process.env.NEXT_PUBLIC_NTA_SIGNALSCOUT;
  const NTA_PRECISIONPRO = process.env.NEXT_PUBLIC_NTA_PRECISIONPRO;
  return (
    <div className="">
      <div className="text-lg">{user.publicMetadata.planname}</div>
      {user.publicMetadata.planid == NTA_SIGNALSCOUT && (
        <div className="text-xs uppercase font-semibold opacity-60">
          Plan Name : Signal Scout
        </div>
      )}
      {user.publicMetadata.planid == NTA_PRECISIONPRO && (
        <div className="text-xs uppercase font-semibold opacity-60">
          Plan Name : Precision Pro <br />
          Status : <span className="text-emerald-700">ACTIVE</span>
        </div>
      )}
      <div className="list-col-wrap text-xl py-2">
        We use Hel.io Payments, a cryptocurrency recurring subscription platform
        that will invoice you at monthly intervals.
        <br />
        You will receive a monthly email notification to resubscribe to your
        membership plan. If you do not resubscribe, your membership will expire.
        <br />
        There are no refunds or chargebacks for paid subscriptions or plan
        changes mid-billing cycle.
      </div>
    </div>
  );
}
