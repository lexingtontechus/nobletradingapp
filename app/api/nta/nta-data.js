import { NextResponse } from "next/server";

export async function GET() {
  // Simulate real-time data with some randomization
  const baseTime = Date.now();

  const data = {
    users: {
      total: 12847 + Math.floor(Math.random() * 100),
      change: (Math.random() * 10 - 5).toFixed(1), // -5 to +5
      trend: Math.random() > 0.5 ? "up" : "down",
    },
    revenue: {
      total: 45230 + Math.floor(Math.random() * 1000),
      change: (Math.random() * 20 - 10).toFixed(1), // -10 to +10
      trend: Math.random() > 0.3 ? "up" : "down",
    },
    orders: {
      total: 1847 + Math.floor(Math.random() * 50),
      change: (Math.random() * 15 - 7.5).toFixed(1), // -7.5 to +7.5
      trend: Math.random() > 0.4 ? "up" : "down",
    },
    conversion: {
      total: (2.4 + Math.random() * 0.8).toFixed(2), // 2.4 to 3.2
      change: (Math.random() * 0.6 - 0.3).toFixed(2), // -0.3 to +0.3
      trend: Math.random() > 0.5 ? "up" : "down",
    },
    timestamp: baseTime,
  };

  return NextResponse.json(data);
}
