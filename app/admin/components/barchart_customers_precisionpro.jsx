"use client";

import * as React from "react";
import { Bar, BarChart, CartesianGrid, XAxis, LabelList } from "recharts";

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

export const description = "Precision Pro Customers";

const chartConfig = {
  views: {
    label: "# of Customers",
  },
  active: {
    label: "Active",
    color: "oklch(62% .214 259.815)", //"var(--chart-2)",
  },
  expired: {
    label: "Expired",
    color: "oklch(.646 .222 41.116)", //"var(--chart-1)",
  },
  renewed: {
    label: "Renewed",
    color: "oklch(.6 .118 184.704)", //"var(--chart-1)",
  },
};

export default function BarChartCustomersPecisionPro({ data }) {
  const [activeChart, setActiveChart] = React.useState("new");

  const chartData = data.map((item) => ({
    date: new Date(item.date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    active: item.active,
    expired: item.expired,
    //renewed: item.renewed,
  }));

  //  const totalPageViews = data.reduce((sum, item) => sum + item.page_views, 0)

  const total = React.useMemo(
    () => ({
      ctive: data.reduce((sum, item) => sum + item.active, 0), //data.reduce((acc, curr) => acc + curr.new, 0),
      expired: data.reduce((sum, item) => sum + item.expired, 0), //data.reduce((acc, curr) => acc + curr.expired, 0)
      //renewed: data.reduce((sum, item) => sum + item.renewed, 0), //data.reduce((acc, curr) => acc + curr.renewed, 0)
    }),
    []
  );

  return (
    <div className="py-4">
      <Card className="py-4">
        <CardHeader className="flex flex-col items-stretch border-b !p-0 sm:flex-row">
          <div className="flex flex-1 flex-col justify-center gap-1 px-6 pt-4 pb-3 sm:!py-0">
            <CardTitle>Precision Pro Month on Month Memberships</CardTitle>
            <CardDescription>
              Showing total members for year to date
            </CardDescription>
          </div>
          <div className="flex">
            {/*{["active", "expired", "renewed"].map((key) => {*/}
            {["active", "expired"].map((key) => {
              const chart = key;
              return (
                <button
                  key={chart}
                  data-active={activeChart === chart}
                  className="data-[active=true]:bg-emerald-500/50 relative z-30 flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left even:border-l even-border sm:border-t-1 sm:border-r sm:border-l sm:px-8 sm:py-6 max-w-24"
                  onClick={() => setActiveChart(chart)}
                >
                  <span className="text-muted-foreground text-xs">
                    {chartConfig[chart].label}
                  </span>
                  <span className="text-lg leading-none font-bold sm:text-3xl">
                    {/* {total[key].toLocaleString()}*/}
                  </span>
                </button>
              );
            })}
          </div>
        </CardHeader>
        <CardContent className="px-2 sm:p-6">
          <ChartContainer
            config={chartConfig}
            className="aspect-auto h-[250px] w-full"
          >
            <BarChart
              accessibilityLayer
              data={data}
              margin={{
                left: 12,
                right: 12,
              }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tickFormatter={(value) => {
                  const date = new Date(value);
                  return date.toLocaleDateString("en-US", {
                    month: "short",
                    //day: "numeric",
                  });
                }}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    className="w-[150px] text-secondary bg-base-300"
                    nameKey="views"
                    labelFormatter={(value) => {
                      return new Date(value).toLocaleDateString("en-US", {
                        month: "short",
                        // day: "numeric",
                        // year: "numeric",
                      });
                    }}
                  />
                }
              />
              <Bar dataKey={activeChart} fill={`var(--color-${activeChart})`}>
                <LabelList
                  position="top"
                  offset={12}
                  className="fill-foreground font-bold"
                  fontSize={12}
                />
              </Bar>
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}
