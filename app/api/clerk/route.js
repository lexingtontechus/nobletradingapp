import { auth, clerkClient } from "@clerk/nextjs/server";

export async function GET() {
  // Use `auth()` to get the user's ID
  const { userId } = await auth();

  // Protect the route by checking if the user is signed in
  if (!userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const client = await clerkClient();

  // Use the Backend SDK's `getUser()` method to get the Backend User object
  const user = await client.users.getUser(userId);

  // Return the Backend User object
  return NextResponse.json({ user: user }, { status: 200 });
}
