"use client";
//import { currentUser, auth } from "@clerk/nextjs/server";
import { useUser } from "@clerk/nextjs";
import { useEffect, useState, useCallback } from "react";
import { redirect } from "next/navigation";

import DiscordNo from "../components/discordno";
import DiscordYes from "../components/discordyes";

export default function Discord() {
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

    // Set up interval for auto-refresh
    const interval = setInterval(fetchDiscord, 10000);

    return () => clearInterval(interval);
  }, [fetchDiscord, isAutoRefresh]);

  return (
    <>
      {user?.publicMetadata.discord == "false" ? <DiscordNo /> : <DiscordYes />}
    </>
  );
}
