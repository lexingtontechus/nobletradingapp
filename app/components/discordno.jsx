"use client";
//import { useUser } from "@clerk/nextjs";
import Link from "next/link";

export default function DiscordNo() {
  const DISCORDURL = process.env.NEXT_PUBLIC_DISCORD_URL;

  return (
    <>
      <li className="list-row">
        <div>
          <img className="my-2 size-12 rounded-box" src="/logoDiscord.svg" />
        </div>
        <div className="list-col-grow">
          <div className="text-lg">Join our Discord community.</div>
          <div className="text-xs uppercase font-semibold opacity-60">
            You will need to be a member for 15mins. Go through the onboarding
            process. Read our terms & agreements.
          </div>
          <div className="py-2 list-col-wrap text-xl">
            Read the community Guide and terms & conditions.
          </div>
        </div>
        <div className="btn btn-block w-40 blurple uppercase">
          <Link href={DISCORDURL} target="_blank">
            JOIN DISCORD
          </Link>
        </div>
      </li>
    </>
  );
}
