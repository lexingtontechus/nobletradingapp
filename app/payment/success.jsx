"use client"; // Error components must be Client Components

import Link from "next/link";
export default function Success() {
  return (
    <div className="hero h-[800px]">
      <div className="hero-content text-center">
        <div className="max-w-4xl">
          <h1 className="py-4 text-5xl font-bold uppercase">
            Noble Trading App
          </h1>
          <h1 className="py-4 text-5xl font-bold uppercase">
            Payment Status: Success
          </h1>
          <div className="my-24">
            <button className="btn btn-error uppercase font-bold">
              <Link href="/">RETURN HOME</Link>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
