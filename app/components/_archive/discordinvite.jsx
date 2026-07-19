import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { useEffect, useState, useCallback } from "react";

export default function DiscordInvite() {
  const [isInviteLoading, setIsInviteLoading] = useState(false);

  //Create Discord Invite
  const createDiscordInvite = async () => {
    setIsInviteLoading(true);

    try {
      const response = await fetch("/api/discord-invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error("Failed to create Discord invite");
      }

      const invite = await response.json();
      const inviteUrl = `https://discord.gg/${invite.code}`;

      // Open the Discord invite URL in a new tab
      window.open(inviteUrl, "_blank");
    } catch (error) {
      console.error("Error creating Discord invite:", error);
      toast({
        title: "Error",
        description: "Failed to create Discord invite",
        variant: "destructive",
      });
    } finally {
      setIsInviteLoading(false);
    }
  };
  return (
    <div
      onClick={createDiscordInvite}
      disabled={isInviteLoading}
      size="lg"
      className="btn rounded-full max-w-[340px] blurple uppercase"
    >
      <img className="size-8" src="/logoDiscord.svg" />
      {isInviteLoading ? (
        <>
          <span className="loading loading-spinner"></span>"Joining"{" "}
        </>
      ) : (
        "Join Discord"
      )}
    </div>
  );
}
