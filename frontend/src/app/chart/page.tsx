import type { Metadata } from "next";
import { getFeed } from "@/lib/signals/dto";
import { ChartDashboard } from "@/components/signals/chart-dashboard";

export const metadata: Metadata = {
  title: "ETHUSDT chart · EtherSignals",
  description:
    "Live ETHUSDT candles with every trend-signal push marked on the price line — five-timeframe board, new-high/new-low ladder and key levels at a glance.",
};

export const revalidate = 10;

export default async function ChartPage() {
  const { signals } = await getFeed({ limit: 50 });
  return <ChartDashboard initialSignals={signals} />;
}
