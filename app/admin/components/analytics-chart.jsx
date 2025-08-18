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
  page_views: {
    label: "Page Views",
    color: "oklch(.646 .222 41.116)", //hsl(var(--chart-1))",
  },
  unique_visitors: {
    label: "Unique Visitors",
    color: "oklch(.6 .118 184.704)", //"hsl(var(--chart-2))",
  },
  bounce_rate: {
    label: "Bounce Rate %",
    color: "oklch(.6 .118 184.704)", //"hsl(var(--chart-3))",
  },
};

export function AnalyticsChart({ data }) {
  // Format data for the chart
  const chartData = data.map((item) => ({
    date: new Date(item.date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    pageViews: item.page_views,
    uniqueVisitors: item.unique_visitors,
    bounceRate: item.bounce_rate,
  }));

  // Calculate totals for the summary
  const totalPageViews = data.reduce((sum, item) => sum + item.page_views, 0);
  const totalUniqueVisitors = data.reduce(
    (sum, item) => sum + item.unique_visitors,
    0
  );
  const avgBounceRate =
    data.length > 0
      ? (
          data.reduce((sum, item) => sum + item.bounce_rate, 0) / data.length
        ).toFixed(1)
      : 0;

  return (
    <div className="grid gap-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Page Views
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {totalPageViews.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">Last 30 days</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Unique Visitors
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {totalUniqueVisitors.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">Last 30 days</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Avg Bounce Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgBounceRate}%</div>
            <p className="text-xs text-muted-foreground">Last 30 days</p>
          </CardContent>
        </Card>
      </div>

      {/* Area Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Website Traffic Trends</CardTitle>
          <CardDescription>
            Daily page views and unique visitors over time
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="min-h-[400px]">
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
                tickFormatter={(value) => value.toLocaleString()}
              />
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent indicator="dot" />}
              />
              <Area
                dataKey="uniqueVisitors"
                type="natural"
                fill="var(--color-unique_visitors)"
                fillOpacity={0.4}
                stroke="var(--color-unique_visitors)"
                stackId="a"
              />
              <Area
                dataKey="pageViews"
                type="natural"
                fill="var(--color-page_views)"
                fillOpacity={0.4}
                stroke="var(--color-page_views)"
                stackId="a"
              />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Bounce Rate Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Bounce Rate Trend</CardTitle>
          <CardDescription>Daily bounce rate percentage</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="min-h-[300px]">
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
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(value) => `${value}%`}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    indicator="line"
                    formatter={(value) => [`${value}%`, "Bounce Rate"]}
                  />
                }
              />
              <Area
                dataKey="bounceRate"
                type="natural"
                fill="var(--color-bounce_rate)"
                fillOpacity={0.4}
                stroke="var(--color-bounce_rate)"
              />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}
