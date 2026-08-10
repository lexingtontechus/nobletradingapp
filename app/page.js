import Link from "next/link";

export const metadata = {
  title: "Noble Trading — Talaria Live Signal Dashboard",
  description:
    "Talaria is the Noble Trading signal dashboard that lives inside the Hermes desktop app: live Renko charts, entry/stop/target on every signal, market-regime labels, and a 30-day signal health scoreboard. Unlocks with Signal Scout ($199/mo) or Precision Pro ($599/mo).",
};

export default function Home() {
  return (
    <div className="bg-base-200">
      {/* Hero */}
      <section className="hero">
        <div className="hero-content mx-auto max-w-5xl text-center py-20">
          <div>
            <h1 className="text-4xl md:text-5xl font-bold">
              Live trading signals, docked beside your chat
            </h1>
            <p className="text-xl opacity-70 mt-6 max-w-3xl mx-auto">
              Talaria is the Noble Trading signal dashboard that lives inside
              the Hermes desktop app — the same window you already use for chat,
              agents, and work. No separate platform to open, no extra terminal
              to babysit.
            </p>
            <div className="flex flex-wrap justify-center gap-4 mt-8">
              <Link href="/pricing" className="btn btn-primary btn-lg">
                See plans
              </Link>
              <Link href="/waitlist" className="btn btn-secondary btn-lg">
                Join the waitlist
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* What is Talaria */}
      <section className="mx-auto max-w-4xl text-center px-4 pb-16">
        <p className="text-lg opacity-80">
          Talaria shows you what the signal engine sees right now — price
          structure, market regime, signal health, and a simulated portfolio —
          refreshed automatically while you work. When a qualified signal fires,
          it comes to you: a status-bar chip, a docked side pane, and a single
          persistent alert keep the signal stream visible beside your
          conversation, whether or not the dashboard is open.
        </p>
      </section>

      {/* Why the name — link to the Talaria page */}
      <section className="mx-auto max-w-5xl px-4 pb-16">
        <div className="card bg-base-100 border border-primary/30">
          <div className="card-body items-center text-center">
            <svg
              viewBox="0 0 100 100"
              width="56"
              height="56"
              role="img"
              aria-label="Talaria mark"
              className="opacity-90"
            >
              <circle
                cx="24"
                cy="76"
                r="7"
                fill="none"
                stroke="#D9A857"
                strokeWidth="3"
              />
              <path
                d="M27 71 L40 55 L38 68 L52 46 L48 62 L64 38 L58 56 L78 24 L66 50 L84 12"
                fill="none"
                stroke="#D9A857"
                strokeWidth="4.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <h2 className="card-title text-2xl">Why &quot;Talaria&quot;?</h2>
            <p className="max-w-2xl opacity-80">
              In Greek myth, the talaria were the winged sandals that carried
              Hermes between the realms of gods and mortals — the fastest thing
              that moved. In Noble Trader, Talaria is the layer built for
              speed: the signal stream and execution path that carries the
              engine&apos;s read to your fills — and to you — without another
              screen in the way.
            </p>
            <Link href="/talaria" className="btn btn-primary btn-lg mt-4">
              Learn more about Talaria
            </Link>
          </div>
        </div>
      </section>

      {/* Feature highlights */}
      <section className="mx-auto max-w-5xl px-4 pb-16">
        <div className="grid gap-6 md:grid-cols-3">
          <div className="card bg-base-100">
            <div className="card-body">
              <h2 className="card-title">Signals with the levels that matter</h2>
              <p>
                Live Renko brick charts — price action rebuilt as fixed-size
                bricks, so only real moves count — with full entry, stop-loss,
                and take-profit prices on every signal. No truncated digits, no
                guessing the numbers.
              </p>
            </div>
          </div>
          <div className="card bg-base-100">
            <div className="card-body">
              <h2 className="card-title">Market-regime intelligence</h2>
              <p>
                Every signal carries a plain-language regime tag — bull, bear,
                or high or low volatility — so you know the engine&apos;s read on
                the market before you look at the numbers. The hot-signals
                banner shows what&apos;s actionable right now, ranked by
                conviction.
              </p>
            </div>
          </div>
          <div className="card bg-base-100">
            <div className="card-body">
              <h2 className="card-title">Performance analytics</h2>
              <p>
                A 30-day signal health scoreboard — win rate, calibration bias,
                and profit factor — plus signal science per symbol: Markov
                probability, brick-pattern analysis, and a sizing what-if. On
                Precision Pro, a paper portfolio with Sharpe, Sortino, Calmar,
                and max drawdown.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Plans teaser */}
      <section className="mx-auto max-w-5xl px-4 pb-16">
        <h2 className="text-3xl font-bold text-center mb-2">
          Choose the tier that fits how you trade
        </h2>
        <p className="text-center opacity-70 mb-10">
          Talaria unlocks with either of two plans — Signal Scout or Precision
          Pro.
        </p>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="card bg-base-100">
            <div className="card-body">
              <h3 className="card-title">Signal Scout</h3>
              <div className="text-3xl font-bold">
                $199 <span className="text-base opacity-70">/ month</span>
              </div>
              <p>
                Ten curated symbols, quality-gated signals, and the full Talaria
                dashboard — plus community access. The engine does the
                screening, so you only see qualified, high-confidence signals.
              </p>
            </div>
          </div>
          <div className="card bg-base-100">
            <div className="card-body">
              <div className="flex items-center gap-2">
                <h3 className="card-title">Precision Pro</h3>
                <span className="badge badge-secondary">Most Popular</span>
              </div>
              <div className="text-3xl font-bold">
                $599 <span className="text-base opacity-70">/ month</span>
              </div>
              <p>
                The Talaria Trading Agent — 20 curated symbols, live alerts, and
                advanced analytics, including a simulated paper portfolio with a
                full risk-adjusted tear-sheet.
              </p>
            </div>
          </div>
        </div>
        <div className="text-center mt-8">
          <Link href="/pricing" className="btn btn-primary btn-lg">
            See full plans &amp; pricing
          </Link>
          <p className="opacity-70 text-sm mt-6">
            Subscriptions are paid in crypto USDC through a secure MoonPay
            Commerce / Hel.io checkout.
          </p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="hero">
        <div className="hero-content mx-auto max-w-4xl text-center py-20">
          <div>
            <h2 className="text-3xl font-bold">
              Trade with a signal feed you can see through
            </h2>
            <p className="text-lg opacity-70 mt-4">
              New to Noble Trading? Start with Signal Scout and upgrade when
              you&apos;re ready for the full 20-market, analytics-equipped
              experience.
            </p>
            <Link href="/waitlist" className="btn btn-secondary btn-lg mt-8">
              Join the waitlist
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
