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

const chartConfig = {
  new: {
    label: "New",
    color: "oklch(62% .214 259.815)", //hsl(var(--chart-1))",
  },
  expired: {
    label: "Expired",
    color: "oklch(.646 .222 41.116)", //"hsl(var(--chart-2))",
  },
  renewed: {
    label: "Renewed",
    color: "oklch(.6 .118 184.704)", //"hsl(var(--chart-3))",
  },
};

export function LineChartPrecisionPro({ data }) {
  // Format data for the chart
  const chartData = data.map((item) => ({
    date: new Date(item.date).toLocaleDateString("en-US", {
      month: "short",
      //day: "numeric",
    }),
    active: item.active / 109000,
    expired: item.expired / 100000,
    renewed: item.renewed / 100000,
  }));

  // Calculate totals for the summary
  const totalActive = data.reduce((sum, item) => sum + item.active / 100000, 0);
  const totalExpired = data.reduce(
    (sum, item) => sum + item.expired / 100000,
    0
  );
  const avgBounceRate =
    data.length > 0
      ? (
          data.reduce((sum, item) => sum + item.renewed, 0) / data.length
        ).toFixed(1)
      : 0;

  return (
    <div className="container">
      {/* Summary Cards */}
      {/* Area Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Year-To-Date Revenue</CardTitle>
          <CardDescription>
            Aggregated monthly revenue by status
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
              margin={{
                left: 12,
                right: 12,
                top: 12,
                bottom: 12,
              }}
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
                  })
                }
              />
              <ChartTooltip
                className="bg-base-300"
                cursor={false}
                content={
                  <ChartTooltipContent
                    indicator="dot"
                    formatter={(value, name, item, index) => (
                      <>
                        <div
                          className="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-(--color-bg)"
                          style={{
                            "--color-bg": `var(--color-${name})`,
                          }}
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
                dataKey="expired"
                type="natural"
                fill="var(--color-expired)"
                fillOpacity={0.4}
                stroke="var(--color-expired)"
                stackId="a"
              />
              <Area
                dataKey="new"
                type="natural"
                fill="var(--color-new)"
                fillOpacity={0.4}
                stroke="var(--color-new)"
                stackId="a"
              />
              <Area
                dataKey="renewed"
                type="natural"
                fill="var(--color-renewed)"
                fillOpacity={0.4}
                stroke="var(--color-renewed)"
                stackId="a"
              />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}
