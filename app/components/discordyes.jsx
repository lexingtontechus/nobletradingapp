import Link from "next/link";

export default function DiscordYes() {
  const DISCORDURL = process.env.NEXT_PUBLIC_DISCORD_URL;
  return (
    <div className="row">
      <div className="col-grow">
        <div className="text-lg">
          Welcome to the Noble Trading App Discord community
        </div>
        <div className="text-xs uppercase font-semibold opacity-60">
          Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do
          eiusmod tempor incididunt ut labore et dolore magna aliqua.
        </div>
        <div className="col-wrap text-xl py-2">
          Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris
          nisi ut aliquip ex ea commodo consequat.
        </div>
      </div>
      <div className="btn rounded-full max-w-[340px] blurple">
        <img className="size-8" src="/logoDiscord.svg" />
        <Link href={DISCORDURL} target="_blank">
          MEMBERS
        </Link>
      </div>
    </div>
  );
}
