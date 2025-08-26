"use client";
//import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { useEffect, useState, useCallback } from "react";
import DiscordInvite from "./discordinvite";

export default function DiscordNo() {
  const DISCORDURL = process.env.NEXT_PUBLIC_DISCORD_URL;
  const { isSignedIn, user } = useUser();

  //const useremail  = user.publicMetadata.emailAddress; //user.emailAddress; //es[0].emailAddress;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [isAutoRefresh, setIsAutoRefresh] = useState(true);

  //Member Discord join & member search & metadata update
  const fetchDiscord = useCallback(async () => {
    setLoading(true);
    setError(null);
    console.log("NT Starting fetch request");

    try {
      const response = await fetch("/api/discord", {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      console.log("NT API response status:", response.status);

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ error: "Unknown error" }));
        throw new Error(
          `API error: ${response.status} - ${
            errorData.error || "Unknown error"
          }`
        );
      }

      const result = await response.json();
      console.log("NT API response received successfully");
      setData(result);
      setLastUpdated(new Date());
      setIsAutoRefresh(false);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "An error occurred";
      console.error("NT Fetch error:", errorMessage);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    if (!isAutoRefresh) return;

    // Initial fetch
    fetchDiscord();

    // Set up interval for auto-refresh every 60secs
    // Disable auto-refresh on OK response 200
    const interval = setInterval(fetchDiscord, 60000);

    return () => clearInterval(interval);
  }, [fetchDiscord, isAutoRefresh]);
  return (
    <div className="">
      <div className="text-lg">Join our Discord community.</div>
      <div className="text-xs uppercase font-semibold opacity-60">
        You will need to be a member before you can subscribe to our membership
        plans. Go through the onboarding process.
      </div>
      <div className="py-2 col-wrap text-xl">
        Read the community guide and terms & conditions.
      </div>
      <DiscordInvite />
    </div>
  );
}
