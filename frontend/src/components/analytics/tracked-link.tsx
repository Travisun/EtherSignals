"use client";

import type { AnchorHTMLAttributes, ReactNode } from "react";
import { trackEvent, type TrackProps } from "@/lib/analytics";

type TrackedLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  /** Umami event name, e.g. "footer.privacy" */
  event: string;
  /** Optional event properties */
  data?: TrackProps;
  children: ReactNode;
};

/** Anchor that reports a click event before following its href. */
export function TrackedLink({ event, data, children, ...props }: TrackedLinkProps) {
  return (
    <a
      {...props}
      onClick={(e) => {
        trackEvent(event, data);
        props.onClick?.(e);
      }}
    >
      {children}
    </a>
  );
}
