import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import Logo from "./logo";
export default function Header() {
  return (
    <div className="navbar bg-base-100 shadow-sm">
      <div className="flex-1">
        <Logo size={36} padding={0} />
        <Link href="/" className="btn btn-ghost text-xl uppercase px-2">
          Noble Trading App
        </Link>
      </div>
      <div className=" flex-none uppercase px-2">
        <SignedOut>
          <SignInButton>
            <div className="btn btn-accent uppercase">Sign In</div>
          </SignInButton>
        </SignedOut>
        <SignedIn>
          <UserButton/>
        </SignedIn>
      </div>
    </div>
  );
}
