'use client';

import React from 'react';

/** TradingView advanced-chart embed (full TV drawing tools), mapped to the BITGET symbol. */
export function TradingViewEmbed({ symbol, tf }: { symbol: string; tf: string }) {
  const tvTfMap: Record<string, string> = {
    '1m': '1', '2m': '2', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '2h': '120',
    '4h': '240', '6h': '360', '12h': '720', '1d': 'D', '3d': '3D', '1w': 'W', '1M': 'M',
  };
  const interval = tvTfMap[tf] ?? '15';
  const src = `https://www.tradingview.com/widgetembed/?symbol=BITGET%3A${symbol}&interval=${interval}&theme=light&style=1&timezone=Etc%2FUTC&withdateranges=1&hide_side_toolbar=0&allow_symbol_change=1&save_image=0&details=0&hide_volume=0&locale=en`;

  return (
    <div className="h-full w-full">
      <iframe
        key={`${symbol}-${tf}`}
        src={src}
        title="TradingView"
        className="h-full w-full border-0"
        allow="clipboard-write"
        allowFullScreen
      />
    </div>
  );
}
