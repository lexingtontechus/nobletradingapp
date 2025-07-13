"use client";

import {
  SignInButton,
  SignedIn,
  SignedOut,
  UserButton,
  useUser,
  useAuth,
} from "@clerk/nextjs";
import Link from "next/link";
import Logo from "./logo";

const IconAdmin = () => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 448 512"
      fill="currentColor"
    >
      <path d="M96 128a128 128 0 1 0 256 0A128 128 0 1 0 96 128zm94.5 200.2l18.6 31L175.8 483.1l-36-146.9c-2-8.1-9.8-13.4-17.9-11.3C51.9 342.4 0 405.8 0 481.3c0 17 13.8 30.7 30.7 30.7l131.7 0c0 0 0 0 .1 0l5.5 0 112 0 5.5 0c0 0 0 0 .1 0l131.7 0c17 0 30.7-13.8 30.7-30.7c0-75.5-51.9-138.9-121.9-156.4c-8.1-2-15.9 3.3-17.9 11.3l-36 146.9L238.9 359.2l18.6-31c6.4-10.7-1.3-24.2-13.7-24.2L224 304l-19.7 0c-12.4 0-20.1 13.6-13.7 24.2z" />
    </svg>
  );
};

export default function Header() {
  const { has, isLoaded } = useAuth();
  const { user } = useUser();

  //  if (!isLoaded) {
  //    return <span></span>;
  //  }

  //  const isAdmin = has({ role: "org:admin" });
  //const isAdmin = has({ permission: "org:admin:noble_trading_app" });

  return (
    <div className="navbar bg-base-100 shadow-sm">
      <div className="flex-1">
        <Logo size={36} padding={0} />
        <Link href="/" className="btn btn-ghost text-xl uppercase px-2">
          Noble Trading App
        </Link>
      </div>
      <div className=" flex-none uppercase ml-2 px-2">
        <SignedOut>
          <SignInButton>
            <div className="btn btn-secondary font-bold uppercase">Members</div>
          </SignInButton>
        </SignedOut>
        <SignedIn waitlistUrl="/waitlist">
          {/* <UserButton />*/}
          <UserButton>
            {/* user?.publicMetadata.role == "admin" &&) */}
            {user?.publicMetadata.role == "admin" && (
              <UserButton.MenuItems>
                <UserButton.Link
                  label="Admin"
                  labelIcon={<IconAdmin />}
                  href="/nta"
                />
              </UserButton.MenuItems>
            )}
          </UserButton>
        </SignedIn>
      </div>
    </div>
  );
}
