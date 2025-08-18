"use client";
//import { currentUser, auth } from "@clerk/nextjs/server";
import { useUser } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import HomePage from "./components/home";
import DiscordNo from "./components/discordno";
import DiscordYes from "./components/discordyes";
import PostRequestButton from "./components/postrequestbutton";
import ActiveUser from "./components/activeuser";
import SelectPlans from "./components/selectplans";

//{user.primaryEmailAddress.emailAddress} {user.emailAddresses[0].emailAddress}

export default function Home() {
  const DISCORDURL = process.env.NEXT_PUBLIC_DISCORD_URL;
  //const user = await currentUser();
  const { isSignedIn, user } = useUser();

  //Default Home page where user is not signedin
  if (!isSignedIn) return <HomePage />;

  //const useremail  = user.publicMetadata.emailAddress; //user.emailAddress; //es[0].emailAddress;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  //reload user for Discord updates
  const fetchData = async () => {
    try {
      setError(null);
      const response = await user.reload(); //fetch("/api/user");

      if (!response.ok) {
        throw new Error("Failed to fetch data");
      }

      const newData = await response.json();
      setData(newData);
      setLastUpdated(new Date());
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial fetch
    fetchData();

    // Set up interval for refreshing every 3 seconds
    const interval = setInterval(fetchData, 3000);

    // Cleanup interval on component unmount
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-8 mx-auto max-w-4xl">
      <h1 className="text-3xl font-semibold">
        🌅 Welcome to <span className="uppercase">Noble Trading!</span>{" "}
        <span className="text-primary">{user?.firstName}</span>
      </h1>

      <div className="text-xl py-2">
        Manage Your Profile, Go To "Manage Account" At The Top Right of the
        Page.
      </div>

      <ul className="list bg-base-100 rounded-box shadow-md">
        {/*STEP1*/}
        <li className="py-2 opacity-60 tracking-wide text-4xl font-thin tabular-nums">
          The #1 Financial Information Network
        </li>
        {/*Discord yes | no*/}
        {/*New user must join Discord for 15mins before plan selection becomes available*/}
        {user?.publicMetadata.discord == "false" ? (
          <DiscordNo />
        ) : (
          <DiscordYes />
        )}

        {/*STEP2*/}
        <li className="py-2 opacity-60 tracking-wide text-4xl font-thin tabular-nums">
          Memberships
        </li>

        {/*planstatus | active | expired*/}
        {/*Current user display plan details. New & Expired user display plan selection. */}
        {user?.publicMetadata.discord == "true" &&
        user?.publicMetadata.planstatus == "true" ? (
          <ActiveUser user={user} />
        ) : (
          <SelectPlans
            user={user}
            useremail={user.primaryEmailAddress.emailAddress}
          />
        )}
      </ul>
      <PostRequestButton useremail={user.primaryEmailAddress.emailAddress} />
    </div>
  );
}
