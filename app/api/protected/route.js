import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function GET() {
  await auth.protect();

  return NextResponse.json({
    message: "You are not authorized to access this resource",
    timestamp: new Date().toISOString(),
  });
}

export async function POST() {
  await auth.protect();

  return NextResponse.json({
    message: "Protected POST endpoint accessed successfully",
    timestamp: new Date().toISOString(),
  });
}
