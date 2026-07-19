"use client";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

// Year-to-date monthly revenue area chart (all plans combined).
//
// DATA SHAPE (from v_revenue_summary view, aggregated across plans per month):
//   { month: "2026-01-01T00:00:00+00:00", revenue_cents, renewals, new_subscriptions, payment_count }
//
// The chart shows two stacked series:
//   - new_subscriptions revenue (initial payments)
//   - renewals revenue
// Together they sum to total monthly revenue.
//
// Note: v_revenue_summary returns one row per (month, plan_title). The widget
// aggregates across plans before passing here — so each item in `data` has the
// summed revenue + counts for that month.

const chartConfig = {
  new_subscriptions: {
    label: "New",
    color: "oklch(62% .214 259.815)",
  },
  renewals: {
    label: "Renewals",
    color: "oklch(.6 .118 184.704)",
  },
};

function aggregateByMonth(rows) {
  // Rows from v_revenue_summary are per (month, plan_title). Group by month.
  const byMonth = new Map();
  for (const r of rows) {
    const monthKey = String(r.month ?? "").slice(0, 7); // YYYY-MM
    const entry = byMonth.get(monthKey) ?? {
      month: monthKey,
      new_subscriptions: 0,
      renewals: 0,
      revenue_cents: 0,
      payment_count: 0,
    };
    entry.new_subscriptions += r.new_subscriptions ?? 0;
    entry.renewals += r.renewals ?? 0;
    entry.revenue_cents += r.revenue_cents ?? 0;
    entry.payment_count += r.payment_count ?? 0;
    byMonth.set(monthKey, entry);
  }
  return Array.from(byMonth.values()).sort((a, b) =>
    a.month.localeCompare(b.month)
  );
}

export function LineChartPayments({ data }) {
  const aggregated = aggregateByMonth(data ?? []);

  const chartData = aggregated.map((item) => ({
    date: item.month, // YYYY-MM
    new_subscriptions: item.new_subscriptions
      ? Math.round(item.revenue_cents * (item.new_subscriptions / (item.new_subscriptions + item.renewals)) / 100)
      : 0,
    renewals: item.renewals
      ? Math.round(item.revenue_cents * (item.renewals / (item.new_subscriptions + item.renewals)) / 100)
      : 0,
  }));

  const totalRevenue = aggregated.reduce(
    (sum, item) => sum + item.revenue_cents / 100,
    0
  );
  const totalNew = aggregated.reduce(
    (sum, item) => sum + item.new_subscriptions,
    0
  );
  const totalRenewals = aggregated.reduce(
    (sum, item) => sum + item.renewals,
    0
  );

  return (
    <div className="container">
      <Card>
        <CardHeader>
          <CardTitle>Year-To-Date Revenue</CardTitle>
          <CardDescription>
            Aggregated monthly revenue — {totalNew} new · {totalRenewals} renewals ·
            total ${totalRevenue.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={chartConfig}
            className="max-h-[400px] max-w-full"
          >
            <AreaChart
              accessibilityLayer
              data={chartData}
              margin={{ left: 12, right: 12, top: 12, bottom: 12 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(value) => value}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(value) =>
                  value.toLocaleString("en-US", {
                    style: "currency",
                    currency: "USD",
                    currencyDisplay: "symbol",
                    maximumFractionDigits: 0,
                  })
                }
              />
              <ChartTooltip
                className="bg-base-300"
                cursor={false}
                content={
                  <ChartTooltipContent
                    indicator="dot"
                    formatter={(value, name) => (
                      <>
                        <div
                          className="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-(--color-bg)"
                          style={{ "--color-bg": `var(--color-${name})` }}
                        />
                        <div className="text-foreground ml-auto flex items-baseline gap-0.5 font-mono font-medium tabular-nums">
                          ${value}
                        </div>
                        {chartConfig[name]?.label || name}
                      </>
                    )}
                  />
                }
              />
              <Area
                dataKey="new_subscriptions"
                type="natural"
                fill="var(--color-new_subscriptions)"
                fillOpacity={0.4}
                stroke="var(--color-new_subscriptions)"
                stackId="a"
              />
              <Area
                dataKey="renewals"
                type="natural"
                fill="var(--color-renewals)"
                fillOpacity={0.4}
                stroke="var(--color-renewals)"
                stackId="a"
              />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}
