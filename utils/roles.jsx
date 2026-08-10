import { auth, clerkClient } from "@clerk/nextjs/server";

export const checkRole = async (role) => {
  const { userId, sessionClaims } = await auth();
  // Fast path — role embedded in session claims (custom JWT template).
  // Null-safe: sessionClaims.metadata is absent unless the template includes it.
  if (sessionClaims?.metadata?.role === role) return true;
  if (!userId) return false;
  // Authoritative source — Clerk user metadata. The app convention is
  // publicMetadata.role (create-subscription / subscription-status /
  // talaria-claim write it, header.jsx reads it client-side), but older
  // onboarding flows provisioned role into PRIVATE metadata (server-only,
  // invisible to the browser SDK) — fall back to that so legacy users keep
  // working without a data migration.
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    return (
      user.publicMetadata?.role === role ||
      user.privateMetadata?.role === role
    );
  } catch {
    return false;
  }
};
