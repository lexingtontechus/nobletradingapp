import Link from "next/link";

export default function DiscordYes() {
  const DISCORDURL = process.env.NEXT_PUBLIC_DISCORD_URL;
  return (
    <li className="list-row">
      <div>
        <img className="my-2 size-12 rounded-box" src="/logoDiscord.svg" />
      </div>
      <div className="list-col-grow">
        <div className="text-lg">
          Welcome to the Noble Trading App Discord community
        </div>
        <div className="text-xs uppercase font-semibold opacity-60">
          Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do
          eiusmod tempor incididunt ut labore et dolore magna aliqua.
        </div>
        <div className="list-col-wrap text-xl py-2">
          Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris
          nisi ut aliquip ex ea commodo consequat.
        </div>
      </div>
      <div className="btn btn-block w-40 blurple">
        <Link href={DISCORDURL} target="_blank">
          MEMBERS
        </Link>
      </div>
    </li>
  );
}
