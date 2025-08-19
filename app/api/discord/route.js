"use server";

import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";


export async function GET(request) {
  console.log("Noble Trading App Discord API route called");
  const { userId, user } = await auth();
  const client = await clerkClient();
  try {
    const discordToken = process.env.DISCORD_TOKEN;
    const guildId = process.env.DISCORD_GUILID_ID;
    if (!discordToken) {
      console.log("[v0] Discord token not found in environment variables");
      return NextResponse.json(
        { error: "Discord token not configured" },
        { status: 500 }
      );
    }

    console.log("Noble Trading App Making request to Discord API");
    const response = await fetch(
      "https://discord.com/api/v10/guilds/{guildId}/members/search?limit=1&query={userId}",
      {
        method: "GET",
        headers: {
          Authorization: `Bot ${discordToken}`,
          Accept: "application/json",
          "User-Agent": "Noble Trading App (https://nobletrading.app, 1.0.0)",
        },
      }
    );

    console.log(
      "Noble Trading App Discord API response status:",
      response.status
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.log("Noble Trading App Discord API error response:", errorText);
      return NextResponse.json(
        {
          error: `Discord API error: ${response.status} ${response.statusText}`,
          details: errorText,
        },
        { status: response.status }
      );
    }

    if (response.ok) {
      const res = await client.users.updateUser(userId, {
        publicMetadata: {
          role: "member",
          discord: "true",
          planid: "false",
          plantitle: "false",
        },
      });
    }
    const data = await response.json();
    console.log(
      "Noble Trading App Discord API success, data length:",
      JSON.stringify(data).length
    );

    return NextResponse.json({
      data,
      timestamp: new Date().toISOString(),
      message: "Success",
    });
  } catch (error) {
    console.error("Noble Trading App Discord API route error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
