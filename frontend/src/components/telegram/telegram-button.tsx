"use client";

import { Send } from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import { site } from "@/lib/site";

export function TelegramButton({
  size = "md",
  label = "Join Telegram Channel",
  source = "unknown",
}: {
  size?: "sm" | "md" | "lg";
  label?: string;
  source?: string;
}) {
  return (
    <a
      href={site.telegramUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => trackEvent("telegram.click", { source })}
      className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[#229ED9] px-4 text-sm font-medium text-white transition-colors hover:bg-[#1d8cbe]"
      data-size={size}
    >
      <Send className="size-4" />
      {label}
    </a>
  );
}
