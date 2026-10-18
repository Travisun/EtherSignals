import type { Metadata } from "next";
import { getFeed } from "@/lib/signals/dto";
import { ChartDashboard } from "@/components/signals/chart-dashboard";

export const metadata: Metadata = {
  title: "ETHUSDT chart · EtherSignals",
  description:
    "Live ETHUSDT candles with every trend-signal push marked on the price line — five-timeframe board, new-high/new-low ladder and key levels at a glance.",
};

export const dynamic = "force-dynamic";

export default async function ChartPage() {
  const { signals } = await getFeed({ limit: 50 });
  return (
    <main className="min-h-dvh">
      <ChartDashboard initialSignals={signals} />
    </main>
  );
}
