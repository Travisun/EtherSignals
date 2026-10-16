import Image from "next/image";
import { site } from "@/lib/site";

export function Logo({ size = 28 }: { size?: number }) {
  return (
    // aria-hidden: the wordmark next to it carries the accessible name
    <Image
      src="/icons/logo-64.png"
      alt=""
      aria-hidden={true}
      width={size}
      height={size}
      priority
      className="rounded-full select-none"
      draggable={false}
    />
  );
}

export function LogoWordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <Logo size={compact ? 24 : 28} />
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-bold tracking-tight">
          Ether<span className="text-primary">Signals</span>
        </span>
        {!compact ? (
          <span className="mt-0.5 hidden text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground sm:block">
            {site.tagline}
          </span>
        ) : null}
      </span>
    </span>
  );
}
