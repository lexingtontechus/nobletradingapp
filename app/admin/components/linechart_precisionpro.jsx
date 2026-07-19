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

// Precision Pro — year-to-date monthly revenue area chart.
//
// DATA SHAPE (from v_revenue_summary filtered to Precision Pro):
//   { month, revenue_cents, renewals, new_subscriptions, payment_count }

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

export function LineChartPrecisionPro({ data }) {
  const chartData = (data ?? []).map((item) => {
    const total = (item.new_subscriptions ?? 0) + (item.renewals ?? 0);
    const revenue = (item.revenue_cents ?? 0) / 100;
    return {
      date: String(item.month ?? "").slice(0, 7),
      new_subscriptions: total
        ? Math.round(revenue * (item.new_subscriptions / total))
        : 0,
      renewals: total
        ? Math.round(revenue * (item.renewals / total))
        : 0,
    };
  });

  const totalRevenue = (data ?? []).reduce(
    (sum, item) => sum + (item.revenue_cents ?? 0) / 100,
    0
  );
  const totalNew = (data ?? []).reduce(
    (sum, item) => sum + (item.new_subscriptions ?? 0),
    0
  );
  const totalRenewals = (data ?? []).reduce(
    (sum, item) => sum + (item.renewals ?? 0),
    0
  );

  return (
    <div className="container">
      <Card>
        <CardHeader>
          <CardTitle>Precision Pro — Year-To-Date Revenue</CardTitle>
          <CardDescription>
            {totalNew} new · {totalRenewals} renewals · total{" "}
            ${totalRevenue.toLocaleString("en-US", { maximumFractionDigits: 0 })}
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
