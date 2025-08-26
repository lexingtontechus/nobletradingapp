"use server";
import { NextResponse } from "next/server";

export async function POST() {
  try {
    const discordToken = process.env.DISCORD_TOKEN;
    const channelId = "1371244447664177162"; //process.env.DISCORD_GUILD_ID;

    const response = await fetch(
      "https://discord.com/api/v10/channels/1371244447664177162/invites",
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${discordToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          max_age: 1000,
          max_uses: 1,
          unique: true,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.text();
      console.error("Discord Invite Error:", errorData);
      return NextResponse.json(
        { error: "Failed to create Discord invite" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error creating Discord invite:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
