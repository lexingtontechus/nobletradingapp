import Link from "next/link";
export default function Home() {
  return (
    <div className="p-8 mx-auto max-w-4xl">
      <h1 className="text-3xl font-semibold">
        🌅 Welcome to <span className="uppercase">Noble Trading!</span>
      </h1>
      <div className="text-xl py-2">
        Discover a thriving community dedicated to the art and science of
        business finance, focusing on managed investments and stock options
        analysis. Whether you’re a seasoned investor or just starting out, Noble
        Trading welcomes all like-minded individuals looking to enhance their
        financial knowledge and capabilities.
      </div>
      <div className="text-xl py-2">Key Benefits:</div>
      <ul className="text-sm">
        <li>
          📊 Expert Insights: Engage with finance professionals and experienced
          investors who share their strategies and market analysis.
        </li>
        <li>
          💬 Collaborative Discussions: Participate in thought-provoking
          conversations about current market trends and investment
          opportunities.
        </li>
        <li>
          📈 Resource Sharing: Access valuable tools, articles, and resources to
          enhance your personal finance journey.
        </li>
        <li>
          🤝 Networking Opportunities: Connect with fellow members to exchange
          ideas, experiences, and investment tips.
        </li>
        <li>
          🌟 Community Events: Join webinars and workshops that focus on managed
          investments and stock options, led by experts in the field.
        </li>
      </ul>
      <div className="text-xl py-2">
        At <span className="uppercase">Noble Trading</span>, we foster an
        environment of learning, growth, and mutual support in the realm of
        personal finance!
      </div>
      <div className="text-xl py-2">Join The Waitlist.</div>
      <div className="mx-auto text-center p-2">
        <div className="btn btn-secondary rounded-full font-bold uppercase">
          <Link href="/waitlist">Waitlist</Link>
        </div>
      </div>
    </div>
  );
}
