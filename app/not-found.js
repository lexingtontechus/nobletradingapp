"use client"; // Error components must be Client Components

import Link from "next/link";
export default function NotFound() {
  return (
    <div className="hero min-h-screen bg-base-200">
      <div className="hero-content text-center">
        <div className="max-w-md">
          <h1 className="m-4 text-5xl font-bold uppercase">
            Sunset Ventures FX
          </h1>

          <button className="btn btn-error uppercase font-bold">
            <Link href="/">RETURN HOME</Link>
          </button>
        </div>
      </div>
    </div>
  );
}
