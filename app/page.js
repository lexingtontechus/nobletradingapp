import { currentUser, auth } from "@clerk/nextjs/server";
import { PricingTable, UserButton } from "@clerk/nextjs";

import Link from "next/link";
export default async function Home() {
  const DISCORDURL = process.env.NEXT_PUBLIC_DISCORD_URL;
  const user = await currentUser();
  const { has } = await auth();

  // Use `has()` method to check if user has a Plan
  const hasWealthNationPlan = has({ plan: "wealth_nation" });

  if (!user)
    return (
      <div className="p-8 mx-auto max-w-2xl">
        <h1 className="text-3xl font-semibold">
          🌅 Welcome to <span className="uppercase">Noble Trading!</span>
        </h1>
        <div className="text-xl py-2">
          Discover a thriving community dedicated to the art and science of
          business finance, focusing on managed investments and stock options
          analysis. Whether you’re a seasoned investor or just starting out,
          Noble Trading welcomes all like-minded individuals looking to enhance
          their financial knowledge and capabilities.
        </div>
        <div className="text-xl py-2">Key Benefits:</div>
        <ul className="text-sm">
          <li>
            📊 Expert Insights: Engage with finance professionals and
            experienced investors who share their strategies and market
            analysis.
          </li>
          <li>
            💬 Collaborative Discussions: Participate in thought-provoking
            conversations about current market trends and investment
            opportunities.
          </li>
          <li>
            📈 Resource Sharing: Access valuable tools, articles, and resources
            to enhance your personal finance journey.
          </li>
          <li>
            🤝 Networking Opportunities: Connect with fellow members to exchange
            ideas, experiences, and investment tips.
          </li>
          <li>
            🌟 Community Events: Join webinars and workshops that focus on
            managed investments and stock options, led by experts in the field.
          </li>
        </ul>

        <div className="text-xl py-2">
          At <span className="uppercase">Noble Trading</span>, we foster an
          environment of learning, growth, and mutual support in the realm of
          personal finance!
        </div>

        <div className="text-xl py-2">
          Sign in today. Your membership awaits you.
        </div>
      </div>
    );

  return (
    <div className="p-8 mx-auto max-w-5xl">
      <h1 className="text-3xl font-semibold">
        🌅 Welcome to <span className="uppercase">Noble Trading!</span>
      </h1>
      <div className="text-xl py-2">
        {" "}
        Hello <span className="text-primary">{user?.firstName}</span>
      </div>
      <div className="text-xl py-2">
        Manage your subscription. Choose/change a plan.
      </div>
      <div className="py-4">
        <PricingTable />
      </div>
      <div className="mx-auto text-center p-4">
        Manage Your Profile & Billing Information, Go To "Manage Account" At The
        Top Right of the Page.
      </div>
      <div className="text-lg py-2">
        Join our Discord Channel to receive all our Wealth Nation trade signal
        information & community benefits.
      </div>

      <div className="mx-auto text-center p-4">
        <div className="btn btn-accent">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 640 512"
            className="size-8 mx-auto"
          >
            <path d="M524.5 69.8a1.5 1.5 0 0 0 -.8-.7A485.1 485.1 0 0 0 404.1 32a1.8 1.8 0 0 0 -1.9 .9 337.5 337.5 0 0 0 -14.9 30.6 447.8 447.8 0 0 0 -134.4 0 309.5 309.5 0 0 0 -15.1-30.6 1.9 1.9 0 0 0 -1.9-.9A483.7 483.7 0 0 0 116.1 69.1a1.7 1.7 0 0 0 -.8 .7C39.1 183.7 18.2 294.7 28.4 404.4a2 2 0 0 0 .8 1.4A487.7 487.7 0 0 0 176 479.9a1.9 1.9 0 0 0 2.1-.7A348.2 348.2 0 0 0 208.1 430.4a1.9 1.9 0 0 0 -1-2.6 321.2 321.2 0 0 1 -45.9-21.9 1.9 1.9 0 0 1 -.2-3.1c3.1-2.3 6.2-4.7 9.1-7.1a1.8 1.8 0 0 1 1.9-.3c96.2 43.9 200.4 43.9 295.5 0a1.8 1.8 0 0 1 1.9 .2c2.9 2.4 6 4.9 9.1 7.2a1.9 1.9 0 0 1 -.2 3.1 301.4 301.4 0 0 1 -45.9 21.8 1.9 1.9 0 0 0 -1 2.6 391.1 391.1 0 0 0 30 48.8 1.9 1.9 0 0 0 2.1 .7A486 486 0 0 0 610.7 405.7a1.9 1.9 0 0 0 .8-1.4C623.7 277.6 590.9 167.5 524.5 69.8zM222.5 337.6c-29 0-52.8-26.6-52.8-59.2S193.1 219.1 222.5 219.1c29.7 0 53.3 26.8 52.8 59.2C275.3 311 251.9 337.6 222.5 337.6zm195.4 0c-29 0-52.8-26.6-52.8-59.2S388.4 219.1 417.9 219.1c29.7 0 53.3 26.8 52.8 59.2C470.7 311 447.5 337.6 417.9 337.6z" />
          </svg>
          <Link className="uppercase mx-auto" href={DISCORDURL} target="_blank">
            Discord
          </Link>
        </div>
      </div>
    </div>
  );
}
