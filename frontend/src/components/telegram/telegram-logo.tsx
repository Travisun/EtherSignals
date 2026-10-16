import type { CSSProperties } from "react";

export function TelegramLogo({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} aria-hidden={true}>
      <path d="M21.9 4.6 18.9 19c-.2 1-.8 1.2-1.7.8l-4.6-3.4-2.2 2.1c-.3.3-.5.5-1 .5l.3-4.7L18.4 6.7c.4-.3-.1-.5-.6-.2L7.3 13.2l-4.5-1.4c-1-.3-1-1 .2-1.4L20.5 3.2c.8-.3 1.6.2 1.4 1.4Z" />
    </svg>
  );
}

/** Brand gradient disc with the Telegram mark, soft glow included. */
export function TelegramBadge({ size = 44 }: { size?: number }) {
  return (
    <div
      className="relative flex shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#37AEE2] to-[#1E96C8] shadow-lg shadow-[#229ED9]/25"
      style={{ width: size, height: size }}
      aria-hidden={true}
    >
      <TelegramLogo
        className="fill-white"
        style={{ width: size * 0.5, height: size * 0.5 }}
      />
    </div>
  );
}
