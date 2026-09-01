import Link from "next/link";

export const metadata = {
  title: "Talaria | Noble Trading App",
  description:
    "Talaria is the Noble Trading signal. It lives inside the Hermes desktop app: live Renko charts, entry/stop/target on every signal, market-regime labels, and a 30-day signal health scoreboard. Named for Hermes' winged sandals — the layer that makes execution fast.",
};

/* The Talaria mark (docs/talaria/talaria-mark.svg §01): the strap-node ring
   with accelerating feather strokes, drawn left-to-right. Bronze Bright on
   dark surfaces, per the design guide's "accent on dark" role. */
function TalariaMark({ size = 96, color = "#D9A857" }) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label="Talaria mark"
      className="mx-auto"
    >
      <circle
        cx="24"
        cy="76"
        r="7"
        fill="none"
        stroke={color}
        strokeWidth="3"
      />
      <path
        d="M27 71 L40 55 L38 68 L52 46 L48 62 L64 38 L58 56 L78 24 L66 50 L84 12"
        fill="none"
        stroke={color}
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const FEATURES = [
  {
    title: "Live signal dashboard",
    body: "A dedicated dashboard view with per-symbol Renko charts — price action rebuilt as fixed-size bricks, so only real moves count — and full entry, stop-loss, and take-profit prices on every signal. No truncated digits, no guessing the numbers.",
  },
  {
    title: "Market-regime labels",
    body: "Every signal carries a plain-language regime tag — bull, bear, or high or low volatility — so you know the engine's read on the market before you look at the numbers.",
  },
  {
    title: "Hot-signals banner",
    body: "Colored chips of the most recent qualified signals, ranked by the engine's current conviction, each with a friendly regime tag. Stale signals drop off after ten minutes — this is always the what's actionable right now view.",
  },
  {
    title: "Signal health scoreboard",
    body: "Per-symbol performance over the last 30 days: win rate, calibration bias (does the engine win as often as it predicts?), and profit factor — so you can see which symbols' signals deserve your attention.",
  },
  {
    title: "Signal science, per symbol",
    body: "Pick any symbol and get the full read: a brick-pattern analysis of the recent price shape, a probability model of the odds the next move is up, and a sizing what-if showing the suggested position size for the latest signal — the same math the engine uses, shown transparently.",
  },
  {
    title: "Signals beside your chat",
    body: "A dockable status-bar chip and side-pane widget keep new signals visible next to your chat session, and one persistent in-app alert updates with each new qualified signal — local time and regime included, no notification spam.",
  },
  {
    title: "Paper portfolio",
    body: "A simulated trade book — no real money — with a daily equity curve, realized profit measured in units of risk per trade, and a risk-adjusted scorecard: Sharpe, Sortino, Calmar, max drawdown, volatility, and profit factor.",
  },
  {
    title: "Benchmark honesty",
    body: "Paper results are compared daily against an equal-weight benchmark, answering one plain question: is the strategy actually beating just trading everything equally?",
  },
  {
    title: "Daily digest",
    body: "A daily rundown of signal and performance highlights, delivered to wherever you've connected Hermes.",
  },
];

export default function TalariaPage() {
  return (
    <div className="bg-base-200">
      {/* Hero */}
      <section className="hero">
        <div className="hero-content mx-auto max-w-5xl text-center py-20">
          <div>
            <TalariaMark size={112} />
            <p className="font-mono text-xs tracking-[0.24em] uppercase text-primary mt-6">
              Swift Execution · Hermes Agent Plugin
            </p>
            <h1 className="text-5xl md:text-6xl mt-3 tracking-[0.06em]">
              Talaria
            </h1>
            <p className="text-xl opacity-70 mt-6 max-w-3xl mx-auto">
              Live trading signals, docked beside your chat — the Noble Trading
              signal dashboard that lives inside the Hermes desktop app. The
              same window you already use for chat, agents, and work. No
              separate platform to open, no extra terminal to babysit.
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

      {/* The name / what Talaria means */}
      <section className="mx-auto max-w-4xl px-4 pb-16">
        <div className="card bg-base-100 border border-primary/30">
          <div className="card-body">
            <h2 className="card-title text-2xl">Why the name</h2>
            <p className="opacity-80">
              In Greek myth, the <strong>talaria</strong> were the winged
              sandals that carried Hermes between the realms of gods and
              mortals — the fastest thing that moved. As a name for the trading
              layer built around Hermes, it maps directly: Talaria is the layer
              that makes execution fast — order routing, latency-sensitive
              fills, the last mile between a signal and a filled position.
            </p>
            <p className="opacity-80">
              The mark is not a literal sandal. It is the strap-node — the
              ankle buckle, reduced to a single ring — with feathers drawn as
              accelerating diagonal strokes, each one shorter and steeper than
              the last, so the glyph reads as motion rather than as an object
              at rest.
            </p>
            <p className="opacity-80">
              In Noble Trader, that promise carries through the product: the
              signal engine&apos;s read reaches you the moment it fires — a
              status-bar chip, a docked side pane, and a single persistent
              alert keep the qualified-signal stream visible beside your
              conversation, whether or not the dashboard is open. It shows you
              what the engine sees right now — price structure, market regime,
              signal health, and a simulated portfolio — refreshed
              automatically while you work.
            </p>
          </div>
        </div>
      </section>

      {/* Execution-layer stat card (design guide §06) */}
      <section className="mx-auto max-w-5xl px-4 pb-16">
        <div className="card bg-base-100 border border-primary/30">
          <div className="card-body">
            <div className="flex items-center gap-3">
              <TalariaMark size={32} />
              <div>
                <div className="text-lg font-semibold">Talaria</div>
                <div className="font-mono text-[10px] tracking-[0.14em] text-info uppercase">
                  Execution Layer
                </div>
              </div>
            </div>
            <p className="opacity-80 max-w-xl">
              Routes signals from the regime engine to broker fills. Tracks
              slippage and round-trip latency per order.
            </p>
            <div className="grid gap-4 md:grid-cols-3 mt-4">
              <div className="border-t border-primary/20 pt-3">
                <div className="font-mono text-xs uppercase opacity-60">
                  Avg. latency
                </div>
                <div className="font-mono text-2xl text-info mt-1">42ms</div>
              </div>
              <div className="border-t border-primary/20 pt-3">
                <div className="font-mono text-xs uppercase opacity-60">
                  Fill rate
                </div>
                <div className="font-mono text-2xl mt-1">99.8%</div>
              </div>
              <div className="border-t border-primary/20 pt-3">
                <div className="font-mono text-xs uppercase opacity-60">
                  Status
                </div>
                <div className="font-mono text-2xl mt-1 text-success">
                  ● Active
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* What you get */}
      <section className="mx-auto max-w-5xl px-4 pb-16">
        <h2 className="text-3xl font-semibold text-center mb-2">What you get</h2>
        <p className="text-center opacity-70 mb-10">
          Everything below ships inside the Talaria client, unlocked with Signal
          Scout or Precision Pro.
        </p>
        <div className="grid gap-6 md:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="card bg-base-100">
              <div className="card-body">
                <h3 className="card-title text-lg">{f.title}</h3>
                <p className="text-sm opacity-80">{f.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Who it's for */}
      <section className="mx-auto max-w-4xl px-4 pb-16 text-center">
        <h2 className="text-3xl font-semibold mb-4">Who it&apos;s for</h2>
        <p className="text-lg opacity-80 max-w-3xl mx-auto">
          Talaria is for traders who want the engine&apos;s read without adding
          another screen to their workflow. If you live in the Hermes desktop
          app and trade crypto, forex, or metals, it puts the qualified-signal
          stream and the strategy&apos;s real performance next to your chat —
          not in a browser tab. A paid subscription is required; crypto (USDC)
          payment is supported via MoonPay.
        </p>
      </section>

      {/* Plans teaser */}
      <section className="mx-auto max-w-5xl px-4 pb-16">
        <h2 className="text-3xl font-semibold text-center mb-2">
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
              <div className="text-3xl font-semibold">
                $199 <span className="text-base opacity-70">/ month</span>
              </div>
              <p>
                Ten curated symbols, quality-gated signals, and the full Talaria
                dashboard — plus community access. The engine does the
                screening, so you only see qualified, high-confidence signals.
              </p>
              <Link href="/pricing" className="btn btn-primary mt-4">
                See Signal Scout
              </Link>
            </div>
          </div>
          <div className="card bg-base-100">
            <div className="card-body">
              <div className="flex items-center gap-2">
                <h3 className="card-title">Precision Pro</h3>
                <span className="badge badge-secondary">Most Popular</span>
              </div>
              <div className="text-3xl font-semibold">
                $599 <span className="text-base opacity-70">/ month</span>
              </div>
              <p>
                The Talaria Trading Agent — 20 curated symbols, live alerts, and
                advanced analytics, including a simulated paper portfolio with a
                full risk-adjusted tear-sheet.
              </p>
              <Link href="/pricing" className="btn btn-primary mt-4">
                See Precision Pro
              </Link>
            </div>
          </div>
        </div>
        <p className="text-center opacity-70 text-sm mt-6">
          Subscriptions are paid in crypto USDC through a secure MoonPay
          Commerce / Hel.io checkout.
        </p>
      </section>

      {/* Final CTA */}
      <section className="hero">
        <div className="hero-content mx-auto max-w-4xl text-center py-20">
          <div>
            <h2 className="text-3xl font-semibold">
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
